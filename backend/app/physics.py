"""
physics.py
==========
Physical calculations for wheel rotation analysis.

Calculates 20 variables × 3 cases (ideal / air / water).
All configurable wheel parameters are at the top — change them freely.

Usage:
    from app.physics import calculate, detect_phases, format_si, build_user_message
"""

# ── Braking constants from Excel ────────────────────────────────────────────
BRAKING_F  = 1.739e-05  # N  — force  breaking value added in AIR (averaged measurements)
BRAKING_E  = 1.312e-07  # J  — energy breaking value added in AIR
BRAKING_P  = 3.878e-07  # W  — power  breaking value added in AIR
BRAKING_W  = 1.042e-07  # J  — work   breaking value added in AIR
WATER_MULT = 816         # water = ideal + (air breaking value) * 816


import math

# ══════════════════════════════════════════════════════════════════════
#  WHEEL PARAMETERS — change these freely
# ══════════════════════════════════════════════════════════════════════

PI = 3.1415926535

# Geometry — all radii are correct; other values are examples
# Change num_spokes to 6, 8, 10 etc. — recalculates everything
R_spoke  = 0.032   # (m) spoke length  (Excel L = 32 mm)
r_hub    = 0.004   # (m) hub radius
L_force  = R_spoke + r_hub  # = 0.036 m — radius where external force acts (Excel r_hub + L)

# Mass — examples, change freely
m_hub      = 1.36e-4   # (kg) hub mass
m_spoke    = 1.8e-5    # (kg) mass of ONE spoke
num_spokes = 8         # number of spokes

# Physical constants
g                       = 9.81    # (m/s²) gravitational acceleration
# density_ratio_water_air = 816  # REMOVED: water braking measured directly
PLANCK                  = 6.626e-34  # (Js) Planck constant

# ══════════════════════════════════════════════════════════════════════
#  SI PREFIX FORMATTER
# ══════════════════════════════════════════════════════════════════════

_SI_PREFIXES = [
    (1e24, "Y"),  # yotta
    (1e21, "Z"),  # zetta
    (1e18, "E"),  # exa
    (1e15, "P"),  # peta
    (1e12, "T"),  (1e9,  "G"),  (1e6,  "M"),
    (1e3,  "k"),  (1e0,  ""),   (1e-3, "m"),
    (1e-6, "µ"),  (1e-9, "n"),  (1e-12,"p"),
    (1e-15,"f"),  (1e-18,"a"),  (1e-21,"z"),
]

def format_si(value, unit: str, decimals: int = 3) -> str:
    if value is None: return "n/a"
    """
    Format value with SI prefix for user display.
    Example: format_si(4.62e-9, "J") → "4.620 nJ"
    """
    if value == 0:
        return f"0.000 {unit}"
    if value is None: return "n/a"
    abs_val = abs(value)
    for factor, prefix in _SI_PREFIXES:
        if abs_val >= factor:
            scaled = value / factor
            return f"{scaled:.{decimals}f} {prefix}{unit}"
    return f"{value:.{decimals}e} {unit}"


def format_sci(value, unit: str) -> str:
    if value is None: return "n/a"

def format_math(value, unit: str, decimals: int = 3) -> str:
    """Format as mathematical notation: 4.620×10⁻⁹ J"""
    if value is None: return "n/a"
    if value == 0: return f"0 {unit}"
    import math as _math
    exp = int(_math.floor(_math.log10(abs(value))))
    mantissa = value / (10 ** exp)
    # Superscript digits
    sup = str.maketrans("0123456789-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻")
    exp_str = str(exp).translate(sup)
    return f"{mantissa:.{decimals}f}×10{exp_str} {unit}"

    """
    Format in scientific notation for database storage.
    Example: 8.123e-3 → "8.123*10^-3 J"
    """
    if value == 0:
        return f"0.000 {unit}"
    exp  = int(math.floor(math.log10(abs(value))))
    mant = value / (10 ** exp)
    return f"{mant:.3f}*10^{exp} {unit}"


# ══════════════════════════════════════════════════════════════════════
#  PHASE DETECTION
# ══════════════════════════════════════════════════════════════════════

def detect_phases(timestamps: list, angles_rad: list,
                  min_move_thresh: float = 0.15,   # rad/s — min speed to count as movement (~8.6 deg/s)
                  const_thresh:    float = 0.10,   # fraction of peak for constant phase detection
                  direction_filter: str  = "auto") -> dict:
    """
    Detect motion phases from time-series angle data.

    direction_filter: "auto" | "cw" | "ccw" | "cw+ccw" | "ccw+cw"
      - "cw"      — only clockwise phases
      - "ccw"     — only counter-clockwise phases
      - "cw+ccw"  — CW first, then CCW (paid)
      - "ccw+cw"  — CCW first, then CW (paid)
      - "auto"    — detect dominant direction

    Returns dict:
      t_start    : time of first movement (s)  → t_Lajtner
      t_accel    : duration of acceleration phase (s)
      t_const    : duration of constant speed phase (s)  (0 if none)
      t_decel    : duration of deceleration phase (s)
      phi_accel  : angular displacement during acceleration (rad)
      phi_const  : angular displacement during constant speed (rad)
      phi_decel  : angular displacement during deceleration (rad)
      omega_max  : max angular velocity reached (rad/s)
      direction  : "CW" | "CCW" | "mixed"
      all_phases : list of all detected direction phases (for paid multi-phase)
    """
    if len(timestamps) < 3:
        ep = _empty_phases(); ep["timestamps"] = timestamps; ep["angles_rad"] = angles_rad
        return ep

    # Compute instantaneous angular velocities
    # Use median filter to remove spikes from noisy angle data
    omegas = []
    for i in range(1, len(timestamps)):
        dt = timestamps[i] - timestamps[i-1]
        if dt <= 0: dt = 1e-6
        omegas.append((angles_rad[i] - angles_rad[i-1]) / dt)
    omegas.append(omegas[-1])

    # Smooth velocities: outlier rejection + 5-frame median filter
    # Step 1: hard clip at 3x IQR
    import statistics
    if len(omegas) >= 4:
        sorted_o = sorted(abs(o) for o in omegas)
        q1 = sorted_o[len(sorted_o)//4]
        q3 = sorted_o[3*len(sorted_o)//4]
        iqr = q3 - q1
        clip_max = q3 + 3.0 * iqr if iqr > 0 else q3 * 3.0
        clip_max = max(clip_max, min_move_thresh * 2)
        omegas = [max(-clip_max, min(clip_max, o)) for o in omegas]
    # Step 2: 5-frame median filter
    if len(omegas) >= 5:
        smoothed = []
        for i in range(len(omegas)):
            lo = max(0, i-2)
            hi = min(len(omegas)-1, i+2)
            window = sorted(omegas[lo:hi+1])
            smoothed.append(window[len(window)//2])
        omegas = smoothed

    # Find first movement → t_Lajtner
    # direction_filter: 'cw' expects negative omegas, 'ccw' expects positive
    _want_dir = direction_filter.lower() if direction_filter else "auto"
    t_start = 0.0
    CONSEC_REQUIRED = 4
    for i in range(len(omegas) - CONSEC_REQUIRED + 1):
        window = omegas[i:i+CONSEC_REQUIRED]
        if not all(abs(o) >= min_move_thresh for o in window):
            continue
        all_pos = all(o > 0 for o in window)
        all_neg = all(o < 0 for o in window)
        if _want_dir in ("cw",):
            # CW = negative omega
            if all_neg:
                t_start = timestamps[i]; break
        elif _want_dir in ("ccw",):
            # CCW = positive omega
            if all_pos:
                t_start = timestamps[i]; break
        else:
            # auto: any consistent direction
            if all_pos or all_neg:
                t_start = timestamps[i]; break

    # Determine overall direction
    cw_count  = sum(1 for o in omegas if o >  min_move_thresh)
    ccw_count = sum(1 for o in omegas if o < -min_move_thresh)
    if cw_count > 0 and ccw_count > 0:
        overall_dir = "mixed"
    elif cw_count >= ccw_count:
        overall_dir = "CW"
    else:
        overall_dir = "CCW"

    # Detect all direction-change phases
    all_phases = _detect_all_phases(timestamps, omegas, min_move_thresh)

    # Filter phases by direction_filter
    if direction_filter in ("cw", "ccw"):
        want = "CW" if direction_filter == "cw" else "CCW"
        filtered = [p for p in all_phases if p["direction"] == want]
    elif direction_filter == "cw+ccw":
        cw_phases  = [p for p in all_phases if p["direction"] == "CW"]
        ccw_phases = [p for p in all_phases if p["direction"] == "CCW"]
        filtered   = cw_phases[:1] + ccw_phases[:1]  # first of each
    elif direction_filter == "ccw+cw":
        cw_phases  = [p for p in all_phases if p["direction"] == "CW"]
        ccw_phases = [p for p in all_phases if p["direction"] == "CCW"]
        filtered   = ccw_phases[:1] + cw_phases[:1]
    else:
        filtered = all_phases  # auto: use all

    # Use first phase for primary calculation (or sum all)
    if filtered:
        primary = filtered[0]
    elif all_phases:
        primary = all_phases[0]
    else:
        _ep = _empty_phases(); _ep["timestamps"] = timestamps; _ep["angles_rad"] = angles_rad; return _ep

    # 3-phase segmentation on primary phase data
    # Find start index (first real movement)
    start_idx = 0
    for i, ts in enumerate(timestamps):
        if ts >= t_start:
            start_idx = i
            break

    # Only segment from start_idx onward
    sub_omegas    = omegas[start_idx:]
    sub_timestamps= timestamps[start_idx:]
    sub_angles    = angles_rad[start_idx:]

    # Filter sub_omegas by primary direction sign for correct phase detection
    _dir = primary.get("direction", "CCW")
    _dir_sign = -1 if _dir == "CW" else 1
    # For CW: omegas are negative, invert for peak detection
    directed_omegas = [o * _dir_sign for o in sub_omegas]
    abs_omegas = [abs(o) for o in directed_omegas]
    if not abs_omegas:
        _ep = _empty_phases(); _ep["timestamps"] = timestamps; _ep["angles_rad"] = angles_rad; return _ep

    # Use only frames moving in correct direction
    signed_abs = [max(0, o * _dir_sign) for o in sub_omegas]
    if max(signed_abs) > 0:
        peak_idx = signed_abs.index(max(signed_abs))
    else:
        peak_idx = abs_omegas.index(max(abs_omegas))
    peak_val = abs_omegas[peak_idx]

    const_end = peak_idx
    for i in range(peak_idx, len(abs_omegas)):
        if abs_omegas[i] < peak_val * (1.0 - const_thresh):
            const_end = i
            break

    accel_slice = slice(0, peak_idx+1)
    const_slice = slice(peak_idx, const_end+1)
    decel_slice = slice(const_end, len(sub_timestamps))

    def _phi(sl):
        if sl.start >= len(sub_angles): return 0.0
        stop = min(sl.stop-1, len(sub_angles)-1)
        # Use ultimate value for magnitude; direction is tracked separately
        return abs(sub_angles[stop] - sub_angles[sl.start])

    def _sign():
        """Return sign of primary phase: +1 CCW, -1 CW."""
        if primary.get("direction") == "CW": return -1
        return 1

    def _dt(sl):
        start = min(sl.start, len(sub_timestamps)-1)
        stop  = min(sl.stop-1, len(sub_timestamps)-1)
        return max(0.0, sub_timestamps[stop] - sub_timestamps[start])

    return {
        "t_start":    t_start,
        "timestamps": timestamps,
        "omegas":     omegas,
        "angles_rad": angles_rad,
        "t_accel":    _dt(accel_slice),
        "t_const":    _dt(const_slice),
        "t_decel":    _dt(decel_slice),
        "phi_accel":  _phi(accel_slice),
        "phi_const":  _phi(const_slice),
        "phi_decel":  _phi(decel_slice),
        "omega_max":  max(abs_omegas),
        "direction":  overall_dir,
        "dir_sign":   _dir_sign,
        "all_phases": all_phases,
        "filtered_phases": filtered,
    }


def _detect_all_phases(timestamps, omegas, thresh=0.01) -> list:
    """
    Detect all motion phases including direction changes.
    Returns list of: {direction, t_start, t_end, phi_rad, omega_max}
    """
    phases = []
    if not omegas: return phases

    cur_dir  = None
    seg_start = 0

    for i, om in enumerate(omegas):
        if abs(om) < thresh:
            d = None
        elif om > 0:
            d = "CW"
        else:
            d = "CCW"

        if d != cur_dir:
            if cur_dir is not None and i > seg_start:
                seg_omegas = omegas[seg_start:i]
                phases.append({
                    "direction": cur_dir,
                    "t_start":   timestamps[seg_start],
                    "t_end":     timestamps[min(i, len(timestamps)-1)],
                    "phi_rad":   sum(abs(o) * (timestamps[min(j+seg_start+1, len(timestamps)-1)]
                                               - timestamps[j+seg_start])
                                     for j,o in enumerate(seg_omegas)),
                    "omega_max": max(abs(o) for o in seg_omegas) if seg_omegas else 0,
                })
            cur_dir   = d
            seg_start = i

    # Last segment
    if cur_dir is not None and seg_start < len(timestamps)-1:
        seg_omegas = omegas[seg_start:]
        phases.append({
            "direction": cur_dir,
            "t_start":   timestamps[seg_start],
            "t_end":     timestamps[-1],
            "phi_rad":   sum(abs(o) * (timestamps[min(j+seg_start+1, len(timestamps)-1)]
                                       - timestamps[j+seg_start])
                             for j,o in enumerate(seg_omegas)),
            "omega_max": max(abs(o) for o in seg_omegas) if seg_omegas else 0,
        })

    return [p for p in phases if p["direction"] is not None]


def _empty_phases() -> dict:
    return {
        "t_start":0,"t_accel":0,"t_const":0,"t_decel":0,
        "phi_accel":0,"phi_const":0,"phi_decel":0,
        "omega_max":0,"direction":"CW","dir_sign":1,
        "all_phases":[],"filtered_phases":[],
        "timestamps":[],"omegas":[],"angles_rad":[],
    }


# ══════════════════════════════════════════════════════════════════════
#  MOMENT OF INERTIA
# ══════════════════════════════════════════════════════════════════════

def calc_inertia() -> dict:
    """
    Calculate wheel moment of inertia using Steiner's theorem for spokes.
    J_total = J_hub + num_spokes * J_spoke
    """
    J_hub   = 0.5 * m_hub * (r_hub ** 2)
    d_spoke = r_hub + (R_spoke / 2.0)
    J_spoke = (1.0/12.0) * m_spoke * R_spoke**2 + m_spoke * d_spoke**2
    J_total = J_hub + num_spokes * J_spoke
    return {"J_hub": J_hub, "J_spoke": J_spoke, "J_total": J_total}


# ══════════════════════════════════════════════════════════════════════
#  MAIN CALCULATION — 20 variables × 3 cases
# ══════════════════════════════════════════════════════════════════════

def _add_braking(case: dict, mult: float = 1.0) -> dict:
    """Add Excel air/water braking constants to computed values."""
    c = dict(case)
    def _a(key, val):
        c[key] = (c.get(key) or 0) + val
    _a("F_max",        BRAKING_F * mult)
    _a("F_accel",      BRAKING_F * mult)
    _a("F_avg_active", BRAKING_F * mult)
    _a("F_const",      BRAKING_F * mult)
    _a("E_kin_max",    BRAKING_E * mult)
    c["E_kin_const"] = c.get("E_kin_max", 0)
    _a("P_peak",       BRAKING_P * mult)
    _a("P_const",      BRAKING_P * mult)
    _a("W_total",      BRAKING_W * mult)
    return c


def _fix_pavg(case: dict, t: float) -> dict:
    """Recalculate P_avg = W_total / t after braking constants are added."""
    c = dict(case)
    if t > 0:
        c["P_avg"] = (c.get("W_total") or 0) / t
    return c


def _add_resistance(case: dict, factor: float) -> dict:
    """Excel additive model — ADD a fixed breaking value to the ideal case:
        air   = ideal + C
        water = ideal + C * 816
    The ideal (measured) force/energy/power/work stay the base; a constant
    breaking value is added on top (F,P,E,W each have their own constant).
    Torque, inertia, angular velocity and angular momentum are unchanged
    (they stay equal to the ideal case)."""
    c = dict(case)
    for k in list(c.keys()):
        if   k[:2] == "F_":         c[k] = (c.get(k) or 0) + BRAKING_F * factor
        elif k[:2] == "E_":         c[k] = (c.get(k) or 0) + BRAKING_E * factor
        elif k[:2] == "P_":         c[k] = (c.get(k) or 0) + BRAKING_P * factor
        elif k == "W_total":        c[k] = (c.get(k) or 0) + BRAKING_W * factor
    # work changed → Lajtner (Planck) frequency must follow
    c["planck_freq"] = (c["W_total"] / PLANCK) if c.get("W_total", 0) > 0 else 0.0
    return c


def calculate(phases: dict) -> dict:
    """
    Calculate all 20 physical variables for 3 cases:
      ideal (frictionless), air, water.

    Input:  phases dict from detect_phases()
    Output: dict with:
              inertia    — J_hub, J_spoke, J_total
              kinematics — beta_accel, beta_decel, omega_max, t_total, phi_total
              resistance — M_air, M_water
              ideal / air / water — 20 variables each
              t_lajtner  — time to first movement (s)
              a_lajtner  — angular acceleration at first movement (rad/s²)
    """
    # Raw phase values
    _t_accel_raw   = phases.get("t_accel", 0)
    _t_decel_raw   = phases.get("t_decel", 0)
    _phi_accel_raw = phases.get("phi_accel", 0)
    _phi_decel_raw = phases.get("phi_decel", 0)
    _omega_raw     = phases.get("omega_max", 0)
    _dir_sign      = phases.get("dir_sign", 1)

    # Direct measurements from FULL timestamps and angles (always reliable)
    _ts_all  = phases.get("timestamps", [])
    _ang_all = phases.get("angles_rad", [])
    _t_direct   = float(_ts_all[-1] - _ts_all[0]) if len(_ts_all) >= 2 else 0
    # phi_direct = max excursion from zero across ALL samples
    _phi_direct = max(abs(a) for a in _ang_all) if _ang_all else 0
    # Also compute as total arc length (sum of abs changes) for better accuracy
    _phi_arc = 0.0
    for _i in range(1, len(_ang_all)):
        _phi_arc += abs(_ang_all[_i] - _ang_all[_i-1])
    # Use max excursion (not arc) — matches Excel theta definition
    import logging as _logging; _logging.getLogger(__name__).info(f"[PHYS] t_direct={_t_direct:.2f}s phi_direct={_phi_direct:.6f}rad")

    # Sanity check direct values
    if not (0.1 <= _t_direct <= 300):
        _t_direct = 0
    if _phi_direct < 1e-5:  # < 0.001° is noise
        _phi_direct = 0

    # Use phase values if they make sense, otherwise use direct measurements
    # Excel formula: theta = 0.5*alpha*t^2  →  alpha = 2*theta/t^2
    # Use total measurement as single accel phase when phases not detected
    if _phi_accel_raw > 1e-6 and _t_accel_raw > 0.1:
        t_accel   = _t_accel_raw
        phi_accel = _phi_accel_raw
    else:
        # Fallback: treat entire measurement as acceleration phase
        t_accel   = _t_direct if _t_direct > 0 else 1.0
        phi_accel = _phi_direct if _phi_direct > 0 else 1e-6

    if _phi_decel_raw > 1e-6 and _t_decel_raw > 0.1:
        t_decel   = _t_decel_raw
        phi_decel = _phi_decel_raw
    else:
        # No separate decel phase detected — treat as single accel phase
        # phi_decel = 0 to avoid double-counting
        t_decel   = t_accel
        phi_decel = 0.0

    t_const   = phases.get("t_const", 0)
    phi_const = phases.get("phi_const", 0)

    # omega_max: ALWAYS use kinematic formula like Excel
    # Excel: omega = 2*theta/t  (from theta=0.5*alpha*t^2, omega=alpha*t)
    # Raw velocity from detection is noisy — do NOT use directly
    omega_max = (2.0 * phi_accel / t_accel) if t_accel > 0 else 0
    # Sanity: must be physically plausible (< 100 rad/s for this wheel)
    if omega_max <= 0 or omega_max > 100:
        omega_max = max(_omega_raw, 1e-6)

    # ── Inertia ────────────────────────────────────────────────────────
    inertia = calc_inertia()
    J = inertia["J_total"]

    # ── Kinematics ─────────────────────────────────────────────────────
    # omega_max from measured peak (most reliable)
    om = omega_max if omega_max > 0 else (2.0 * phi_accel / t_accel)
    # beta_accel from omega_max / t_accel (dynamic) — consistent with om
    # Also check kinematic beta = 2*phi/t²
    beta_kin = (2.0 * phi_accel) / (t_accel ** 2) if t_accel > 0 else 0
    beta_dyn = om / t_accel if t_accel > 0 else 0
    # Use dynamic (from measured omega) as primary — more reliable
    beta_accel = beta_dyn if beta_dyn > 0 else beta_kin

    # Angular deceleration from deceleration phase
    # omega at start of decel = omega_max (wheel decelerates from max to 0)
    # beta_decel = omega_max / t_decel
    # Also verify with kinematics: beta_decel = 2*phi_decel / t_decel^2
    # Excel formula: alpha = 2*theta/t^2  (from theta = 0.5*alpha*t^2, start from rest)
    beta_accel_kinematic  = (2.0 * phi_accel) / (t_accel ** 2) if phi_accel > 0 and t_accel > 0 else 0
    beta_decel_kinematic = (2.0 * phi_decel) / (t_decel ** 2) if phi_decel > 0 and t_decel > 0 else 0
    beta_decel_dynamic   = om / t_decel if t_decel > 0 and om > 0 else 0
    # Use kinematic formula as primary (matches Excel: alpha = 2*theta/t^2)
    beta_decel_abs = beta_decel_kinematic if beta_decel_kinematic > 0 else beta_decel_dynamic

    # Constant phase time
    t_const_calc = (phi_const / om) if (om > 0 and phi_const > 0) else t_const

    # t_total = actual measured duration from timestamps
    _ts_all = phases.get("timestamps", [])
    if len(_ts_all) >= 2:
        _t_candidate = float(_ts_all[-1] - _ts_all[0])
        # Sanity check: must be between 0.1s and 300s
        if 0.1 <= _t_candidate <= 300:
            t_total = _t_candidate
        else:
            # fallback: use phase sum
            t_total = t_accel + t_const_calc + t_decel
    else:
        t_total = t_accel + t_const_calc + t_decel
    # Final sanity: t_total must be positive and reasonable
    if t_total < 0.1 or t_total > 300:
        t_total = max(t_accel, 1.0)  # at least 1 second
    phi_total  = phi_accel + phi_const + phi_decel
    # Apply direction sign: CW = negative
    phi_total_signed = phi_total * _dir_sign
    # phi_total = maximum excursion (peak rotation), not final position
    # e.g. wheel goes CW 70° then returns to 15°: phi_total should be 70°
    if "angles_rad" in phases and phases["angles_rad"]:
        _peak = max(abs(a) for a in phases["angles_rad"])
        if _peak > phi_total * 0.5:
            phi_total = _peak  # use peak (max excursion)
    t_active   = max(t_accel + t_const_calc, 1e-6)
    phi_active = max(phi_accel + phi_const,  1e-9)

    # ── Excel model: uniform acceleration from REST over the WHOLE measurement ──
    # Excel Step 4:  alpha = 2*theta / t^2      (theta = total displacement, t = total time)
    # Excel Step 7:  omega = alpha * t = 2*theta / t
    # This overrides the phase-based peak omega so every derived value
    # (torque, force, energy, power, work, momentum) matches the Excel sheet.
    if t_total > 0 and phi_total > 0:
        beta_accel = (2.0 * phi_total) / (t_total ** 2)
        om         = beta_accel * t_total

    # ── Resistance torques ─────────────────────────────────────────────
    # Both air and water: M_res = J * beta_decel (from real deceleration measurement)
    # The user measures in the actual medium (air or water).
    # For air video:   M_air   = J * beta_decel_air
    # For water video: M_water = J * beta_decel_water
    # We calculate both from the SAME deceleration beta — the medium was set by user.
    # NOTE: 816 multiplier is REMOVED — no approximation needed.
    M_res_measured = J * beta_decel_abs   # actual braking torque in the measured medium
    M_air   = M_res_measured              # braking in air (if medium=air)
    M_water = M_res_measured              # braking in water (if medium=water)
    # Both cases use the same measured value — physics formulas are identical

    # ── Lajtner values ─────────────────────────────────────────────────
    t_lajtner = phases.get("t_start", 0.0)
    # a_Lajtner: only calculable if t_Lajtner > 0
    LAJTNER_WINDOW = 0.25  # seconds
    a_lajtner = None  # default: not calculable
    # a_Lajtner = angular acceleration (rad/s²) in first 0.25s of motion
    if t_lajtner > 0 and "timestamps" in phases and "omegas" in phases:
        ts_all = phases["timestamps"]
        om_all = phases["omegas"]
        t0 = t_lajtner
        t1 = t0 + LAJTNER_WINDOW
        # Find omega at start of motion and 0.25s later
        idx0 = next((i for i,t in enumerate(ts_all) if t >= t0), None)
        idx1 = next((i for i,t in enumerate(ts_all) if t >= t1), None)
        if idx0 is None:
            idx0 = 0
        if idx1 is None:
            idx1 = min(idx0 + 1, len(ts_all) - 1)
        if idx1 > idx0 and len(om_all) > max(idx0, idx1):
            dt_w = ts_all[idx1] - ts_all[idx0]
            om_start = om_all[idx0]
            om_end   = om_all[idx1]
            if dt_w > 0 and (abs(om_start) > 1e-6 or abs(om_end) > 1e-6):
                a_lajtner = (om_end - om_start) / dt_w  # rad/s²

    # Correct t_total: physics time starts from first movement, not t=0
    # t_total already = t_accel + t_const + t_decel which is relative to motion start
    # But if t_start was detected late, t_accel may be too small
    # Use: if t_start > 0, the real motion time is correct from phase segmentation

    # ── Per-case calculation ───────────────────────────────────────────
    def _case(M_res: float) -> dict:
        """Calculate all 20 variables for one resistance case."""

        # 6. Required Accelerating Torque
        M_motor_accel = J * beta_accel + M_res

        # 7. Constant Motion Torque
        M_motor_const = M_res

        # 10. Required Accelerating Force (at L_force radius)
        F_accel = M_motor_accel / L_force

        # 9. Constant Motion Driving Force
        F_const = M_motor_const / L_force if L_force > 0 else 0.0

        # 13. Rotational Kinetic Energy at max speed
        E_kin_max = 0.5 * J * om**2

        # 16. Peak Power
        P_peak = M_motor_accel * om

        # 12. Maximum Driving Force (same as F_accel at end of acceleration)
        F_max = F_accel

        # 17. Constant Motion Power
        P_const = M_motor_const * om

        # 19. Total Work Done
        # Excel formula: W_total = KE = 0.5 * J * omega²
        # Work = kinetic energy (for wheel accelerating from rest)
        W_total = E_kin_max

        # 18. Average Power  (Excel: P_avg = KE/t = W_total/t)
        P_avg = W_total / max(t_total, 1e-6)

        # 8. Average Torque (active phase) = motor torque
        # Excel: M_avg_active = M_motor_accel (driving torque during active phase)
        # M_avg_active = driving torque = M_motor_accel
        M_avg_active = M_motor_accel

        # 11. Average Driving Force = motor force
        F_avg_active = M_avg_active / L_force

        # 15. Average Rotational Energy (active phase)
        # Time-weighted average: (E_avg_accel * t_accel + E_max * t_const) / t_active
        E_kin_avg_accel  = (1.0/3.0) * E_kin_max
        E_kin_avg_active = (E_kin_avg_accel * t_accel + E_kin_max * t_const_calc) / t_active

        # 20. Angular Momentum
        L_ang = J * om

        # Planck hypothetical frequency (paid version)
        planck_freq = W_total / PLANCK if W_total > 0 else 0.0

        # Angular acceleration (Excel: alpha = 2*theta/t^2) and average angular velocity
        alpha     = beta_accel
        omega_avg = (phi_total / t_total) if t_total > 0 else 0.0

        return {
            "t_total":          t_total,           # 1
            "phi_total":        phi_total,          # 2
            "omega_max":        om,                 # 3
            "J":                J,                  # 4
            "M_res":            M_res,              # 5
            "M_motor_accel":    M_motor_accel,      # 6
            "M_motor_const":    M_motor_const,      # 7
            "M_avg_active":     M_avg_active,       # 8
            "F_const":          F_const,            # 9
            "F_accel":          F_accel,            # 10
            "F_avg_active":     F_avg_active,       # 11
            "F_max":            F_max,              # 12
            "E_kin_max":        E_kin_max,          # 13
            "E_kin_const":      E_kin_max,          # 14 same at constant speed
            "E_kin_avg_active": E_kin_avg_active,   # 15
            "P_peak":           P_peak,             # 16
            "P_const":          P_const,            # 17
            "P_avg":            P_avg,              # 18
            "W_total":          W_total,            # 19
            "L_ang":            L_ang,              # 20
            "alpha":            alpha,              # angular acceleration (rad/s²)
            "omega_avg":        omega_avg,          # average angular velocity (rad/s)
            "planck_freq":      planck_freq,
        }

    # ── 3 cases (Excel model) ──────────────────────────────────────────
    # ideal = frictionless base; air = 2× ideal; water = 816× air.
    # ideal = frictionless base; air = ideal + C; water = ideal + C*816.
    # Only force / energy / power / work get the breaking value — see _add_resistance().
    _ideal = _case(M_res=0.0)
    return {
        "inertia":    inertia,
        "kinematics": {
            "beta_accel": beta_accel,
            "beta_decel": beta_decel_abs,
            "omega_max":  om,
            "t_total":    t_total,
            "phi_total":  phi_total,
            "t_active":   t_active,
            "phi_active": phi_active,
        },
        "resistance": {"M_air": M_air, "M_water": M_water},
        "t_lajtner":  t_lajtner,
        "a_lajtner":  a_lajtner,
        "ideal":      _ideal,
        "air":        _add_resistance(_ideal, 1.0),
        "water":      _add_resistance(_ideal, WATER_MULT),
    }


# ══════════════════════════════════════════════════════════════════════
#  CSV ROW BUILDER
# ══════════════════════════════════════════════════════════════════════

UNITS = {
    "t_total":"s",       "phi_total":"rad",      "omega_max":"rad/s",
    "J":"kgm2",          "M_res":"Nm",           "M_motor_accel":"Nm",
    "M_motor_const":"Nm","M_avg_active":"Nm",
    "F_const":"N",       "F_accel":"N",          "F_avg_active":"N",  "F_max":"N",
    "E_kin_max":"J",     "E_kin_const":"J",      "E_kin_avg_active":"J",
    "P_peak":"W",        "P_const":"W",          "P_avg":"W",
    "W_total":"J",       "L_ang":"kgm2_per_s",
}

VARIABLE_NAMES = [
    "t_total","phi_total","omega_max","J","M_res",
    "M_motor_accel","M_motor_const","M_avg_active",
    "F_const","F_accel","F_avg_active","F_max",
    "E_kin_max","E_kin_const","E_kin_avg_active",
    "P_peak","P_const","P_avg","W_total","L_ang",
]


def build_csv_row(email: str, job_id: str, timestamp: str,
                  sample_interval_ms: int, medium: str,
                  phases: dict, result: dict) -> dict:
    """
    Build flat dict for CSV (semicolon-separated, UTF-8) and DB storage.
    All values in scientific notation: 8.123*10^-3 J
    Column headers include units.
    """
    row = {
        "email":              email,
        "job_id":             job_id,
        "timestamp":          timestamp,
        "sample_interval_ms": sample_interval_ms,
        "medium":             medium,
        "direction":          phases.get("direction", ""),
        # Lajtner values
        "t_lajtner_s":        format_sci(result["t_lajtner"], "s"),
        "a_lajtner_rad_s2":   format_sci(result.get("a_lajtner"), "rad/s2"),
        # Phase durations
        "t_accel_s":          format_sci(phases["t_accel"],   "s"),
        "t_const_s":          format_sci(phases["t_const"],   "s"),
        "t_decel_s":          format_sci(phases["t_decel"],   "s"),
        # Phase angles
        "phi_accel_rad":      format_sci(phases["phi_accel"], "rad"),
        "phi_const_rad":      format_sci(phases["phi_const"], "rad"),
        "phi_decel_rad":      format_sci(phases["phi_decel"], "rad"),
        # Inertia
        "J_hub_kgm2":         format_sci(result["inertia"]["J_hub"],   "kgm2"),
        "J_spoke_kgm2":       format_sci(result["inertia"]["J_spoke"], "kgm2"),
        "J_total_kgm2":       format_sci(result["inertia"]["J_total"], "kgm2"),
        # Resistance
        "M_air_Nm":           format_sci(result["resistance"]["M_air"],   "Nm"),
        "M_water_Nm":         format_sci(result["resistance"]["M_water"], "Nm"),
    }

    # 20 variables × 3 cases
    for case_name in ("ideal", "air", "water"):
        case = result[case_name]
        for var in VARIABLE_NAMES:
            unit = UNITS.get(var, "")
            key  = f"{case_name}_{var}_{unit}"
            row[key] = format_math(case[var], unit)

    return row


# ══════════════════════════════════════════════════════════════════════
#  USER MESSAGE BUILDER
# ══════════════════════════════════════════════════════════════════════

# All user-facing messages — change text freely
MESSAGES = {
    "en": {
        "rotated_free":  "Congrats, your power is great! ",
        "not_rotated":   "You need to practice a little more! 💪",
        "suspicious":    "Are you sure this result came out correctly? ⚠️",
        # Personal ranking (paid)
        "above_avg":     "Congrats, You are excellent! 🥇",
        "at_avg":        "Congrats, You are in good shape! ",
        "below_avg":     "Congrats, your power works! ",
        # Group ranking (paid)
        "ranking_intro": "Let's see your ranking among people!",
        "above_group":   "Congrats, this is above average! ",
        "at_group":      "Awesome! You're in the elite few! ",
        "below_group":   "Congrats, You're not above average yet, but with practice you'll soon be! ",
    },
    "hu": {
        "rotated_free":  "Gratulálok, nagy az erőd! ",
        "not_rotated":   "Még egy kicsit gyakorolni kell! 💪",
        "suspicious":    "Biztos, hogy ez az eredmény helyes? ⚠️",
        "above_avg":     "Gratulálok, kiváló vagy! 🥇",
        "at_avg":        "Gratulálok, jó formában vagy! ",
        "below_avg":     "Gratulálok, az erőd működik! ",
        "ranking_intro": "Nézzük, hol állsz mások között!",
        "above_group":   "Gratulálok, átlag feletti vagy! ",
        "at_group":      "Gratulálok, kiváló eredmény, kevesen előznek meg! ",
        "below_group":   "Gratulálok, még nem vagy átlag felett, de hamarosan ott leszel! ",
    },
    "de": {
        "rotated_free":  "Glückwunsch, deine Kraft ist toll! ",
        "not_rotated":   "Du musst noch etwas üben! 💪",
        "suspicious":    "Bist du sicher, dass dieses Ergebnis korrekt ist? ⚠️",
        "above_avg":     "Glückwunsch, du bist ausgezeichnet! 🥇",
        "at_avg":        "Glückwunsch, du bist in guter Form! ",
        "below_avg":     "Glückwunsch, deine Kraft funktioniert! ",
        "ranking_intro": "Mal sehen, wie du im Vergleich abschneidest!",
        "above_group":   "Glückwunsch, das ist überdurchschnittlich! ",
        "at_group":      "Glückwunsch, tolles Ergebnis! ",
        "below_group":   "Noch nicht überdurchschnittlich, aber bald! ",
    },
}


def build_user_message(result: dict, medium: str,
                       version: str = "basic",
                       lang: str = "en",
                       user_avg: dict = None,
                       group_avg: dict = None) -> dict:
    """
    Build user-facing message dict.

    Parameters:
      result    : from calculate()
      medium    : "air" | "water" | "ideal"
      version   : "basic" | "pro"
      lang      : "en" | "hu" | "de"
      user_avg  : dict of user's personal averages (paid, optional)
      group_avg : dict of group averages (paid, optional)

    Returns dict with:
      moved        : bool
      message      : main message string
      display      : values to show user (free: rotation+force, paid: +power+work+planck)
      t_lajtner_s  : float
      a_lajtner    : SI string
      warning      : suspicious result warning (if applicable)
      rank_message : personal rank message (paid)
      rank_medal   : "gold"|"silver"|"bronze" (paid)
      group_message: group rank message (paid)
      group_medal  : "gold"|"silver"|"bronze" (paid)
    """
    # Ultimate 1.0 uses the IDEAL case (no braking force) — client spec:
    # "in Ultimate use simple calculations without braking force,
    #  the differences are greater, gives a better solution"
    if version == "ultimate":
        case = result.get("ideal") or result.get(medium) or result.get("air", {})
    else:
        case = result.get(medium) or result.get("air", {})
    W_total = case.get("W_total", 0)
    F_max   = case.get("F_max",   0)
    P_peak  = case.get("P_peak",  0)
    phi_rad = case.get("phi_total", 0)
    phi_deg = math.degrees(abs(phi_rad))
    # Use max observed cumulative if available — more accurate for user display
    if result.get("max_cum_deg"):
        phi_deg = abs(result["max_cum_deg"])
    moved   = phi_deg > 0.5

    msgs = MESSAGES.get(lang, MESSAGES["en"])

    def _sci(v):
        """Format as scientific notation e.g. 3.4e-8"""
        if v is None: return "n/a"
        if v == 0: return "0"
        import math as _m
        a = abs(v)
        if a == 0: return "0"
        exp = int(_m.floor(_m.log10(a)))
        man = v / (10**exp)
        return f"{man:.3g}e{exp:+d}"

    out = {
        "moved":       moved,
        "phi_deg":     round(phi_deg, 2),
        "F_max_si":    _sci(F_max),
        "t_lajtner_s": round(result.get("t_lajtner", 0), 3),
        "a_lajtner":   _sci(result.get("a_lajtner")),
        "message":     msgs["rotated_free"] if moved else msgs["not_rotated"],
    }

    # ── Free version display ───────────────────────────────────────────
    if version == "basic":
        planck_freq_free = case.get("planck_freq", 0)
        out["display"] = {
            "rotation_deg":   f"{phi_deg:.2f} °",
            "force_N":        _sci(F_max),
            "planck_freq_Hz": f"{planck_freq_free:.2e}" if planck_freq_free else None,
            "planck_freq_raw": planck_freq_free,
        }
        return out

    # ── Paid version — full display ────────────────────────────────────
    planck_freq = case.get("planck_freq", 0)
    out["display"] = {
        "rotation_deg":   f"{phi_deg:.2f} °",
        "force_N":        _sci(F_max),
        "power_W":        _sci(P_peak),
        "energy_J":         _sci(W_total),
        "planck_freq_Hz": f"{planck_freq:.2e}".replace('e+', 'e+').replace('e-0', 'e-').replace('e+0', 'e+'),
        "planck_freq_raw": planck_freq,
    }

    # ── Personal ranking (paid) ────────────────────────────────────────
    if user_avg:
        avg_val = user_avg.get("cumulative_deg", phi_deg)
        pct     = (phi_deg - avg_val) / avg_val * 100 if avg_val else 0
        if pct > 5:
            out["rank_message"] = msgs["above_avg"]
            out["rank_medal"]   = "gold"
        elif pct >= -5:
            out["rank_message"] = msgs["at_avg"]
            out["rank_medal"]   = "silver"
        else:
            out["rank_message"] = msgs["below_avg"]
            out["rank_medal"]   = "bronze"
        out["pct_vs_personal_avg"] = round(pct, 1)

    # ── Group ranking (paid) ───────────────────────────────────────────
    if group_avg:
        out["group_intro"] = msgs["ranking_intro"]
        avg_val = group_avg.get("cumulative_deg", phi_deg)
        pct     = (phi_deg - avg_val) / avg_val * 100 if avg_val else 0
        if pct > 5:
            out["group_message"] = msgs["above_group"]
            out["group_medal"]   = "gold"
        elif pct >= -5:
            out["group_message"] = msgs["at_group"]
            out["group_medal"]   = "silver"
        else:
            out["group_message"] = msgs["below_group"]
            out["group_medal"]   = "bronze"
        out["pct_vs_group_avg"] = round(pct, 1)

    return out


# ══════════════════════════════════════════════════════════════════════
#  QUICK TEST
# ══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    phases = {
        "t_start":   0.0,
        "t_accel":   7.0,
        "t_const":   0.175,
        "t_decel":   3.0,
        "phi_accel": math.radians(40.0),
        "phi_const": math.radians(2.0),
        "phi_decel": math.radians(3.0),
        "omega_max": 0.199466,
        "direction": "CW",
        "all_phases": [],
        "filtered_phases": [],
    }

    result = calculate(phases)

    print("=" * 60)
    print(f"J_total = {format_sci(result['inertia']['J_total'], 'kgm2')}")
    print(f"M_air   = {format_sci(result['resistance']['M_air'], 'Nm')}")
    print(f"M_water = {format_sci(result['resistance']['M_water'], 'Nm')}")
    print()

    for case_name in ("ideal", "air", "water"):
        print(f"── {case_name.upper()} ──")
        c = result[case_name]
        for var in VARIABLE_NAMES:
            unit = UNITS.get(var, "")
            print(f"  {var:25s} = {format_sci(c[var], unit):20s}  {format_si(c[var], unit)}")
        print()

    msg = build_user_message(result, "air", version="pro", lang="en",
                             user_avg={"cumulative_deg": 40.0},
                             group_avg={"cumulative_deg": 35.0})
    print("Message:", msg["message"])
    print("Display:", msg["display"])
    print("Rank:",    msg.get("rank_message"))
    print("Group:",   msg.get("group_message"))