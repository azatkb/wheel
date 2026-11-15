"""
BACKEND PATCH — vstavit' v main.py (main_srv.py)
=================================================
8 izmeneniy po trebovaniyu klienta (Tamas).

INSTRUKCII:
1. SQL migracii — zapusti PERVYM DELOM (v Supabase SQL Editor)
2. Novye endpointy — vstavit' v main.py
3. Izmeneniya v sushchestvuyushchih endpointah

"""

# ═══════════════════════════════════════════════════════════════
# STEP 1: SQL MIGRATIONS — zapusti v Supabase SQL Editor
# ═══════════════════════════════════════════════════════════════

SQL_MIGRATIONS = """
-- 1. Personal Security Code
ALTER TABLE wt_users ADD COLUMN IF NOT EXISTS security_code TEXT;
ALTER TABLE wt_users ADD COLUMN IF NOT EXISTS security_code_shown BOOLEAN DEFAULT FALSE;

-- 2. Age confirmation
ALTER TABLE wt_users ADD COLUMN IF NOT EXISTS age_confirmed BOOLEAN DEFAULT FALSE;

-- 3. Focus Test consent
ALTER TABLE wt_users ADD COLUMN IF NOT EXISTS focus_consent BOOLEAN DEFAULT FALSE;
ALTER TABLE wt_users ADD COLUMN IF NOT EXISTS focus_consent_at TIMESTAMPTZ;
ALTER TABLE wt_users ADD COLUMN IF NOT EXISTS focus_consent_withdrawn BOOLEAN DEFAULT FALSE;
"""


# ═══════════════════════════════════════════════════════════════
# STEP 2: NOVYE ENDPOINTY — vstavit' posle bloka auth
# ═══════════════════════════════════════════════════════════════

# ---------- [TASK 1] Personal Security Code ----------

# Vstav' etu funkciyu ryadom s _hash_pw():

def _generate_security_code():
    """Generate a 12-char alphanumeric security code (like a PIN, non-recoverable)."""
    import secrets, string
    alphabet = string.ascii_uppercase + string.digits
    # Format: XXXX-XXXX-XXXX
    raw = ''.join(secrets.choice(alphabet) for _ in range(12))
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:12]}"


# V endpoint /auth/login — ZAMENI return stroku na:
"""
@app.post("/auth/login")
async def auth_login(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    recaptcha_token = body.get("recaptcha_token") or ""
    if not await _verify_recaptcha(recaptcha_token):
        raise HTTPException(400, "reCAPTCHA verification failed. Please try again.")
    user = _get_user(email)
    if not user or user.get("password_hash") != _hash_pw(password):
        raise HTTPException(401, "Invalid email or password")
    if user.get("blocked"):
        raise HTTPException(403, "This account has been suspended.")
    token = secrets.token_hex(32)

    # --- Personal Security Code: generate on first login ---
    security_code = user.get("security_code")
    show_security_code = False
    if not security_code:
        from app.database import _sb
        sb = _sb()
        security_code = _generate_security_code()
        sb.table("wt_users").update({
            "security_code": security_code,
            "security_code_shown": False
        }).eq("email", email).execute()
        show_security_code = True
    elif not user.get("security_code_shown"):
        show_security_code = True

    result = {"token": token, "email": email, "plan": user.get("plan", "basic")}

    if show_security_code:
        result["security_code"] = security_code
        result["security_code_first_show"] = True
        # Mark as shown
        from app.database import _sb
        sb = _sb()
        sb.table("wt_users").update({"security_code_shown": True}).eq("email", email).execute()

    return result
"""


# Novyy endpoint — udalit' dannye po security code:
"""
@app.post("/auth/delete-by-security-code")
async def auth_delete_by_security_code(request: Request):
    \"\"\"Delete user data using Personal Security Code (no chip needed).\"\"\"
    from app.database import _sb
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    code  = (body.get("security_code") or "").strip().upper()
    if not email or not code:
        raise HTTPException(400, "Email and security code required")
    user = _get_user(email)
    if not user:
        raise HTTPException(404, "User not found")
    if (user.get("security_code") or "").upper() != code:
        raise HTTPException(403, "Invalid security code")

    sb = _sb()
    # Delete user's measurement data
    sb.table("physics_results").delete().eq("user_email", email).execute()
    sb.table("focus_questionnaire").delete().eq("user_email", email).execute()
    # Delete forum data
    sb.table("forum_posts").delete().eq("user_email", email).execute()
    sb.table("forum_comments").delete().eq("user_email", email).execute()
    # Clear the user account (keep email for re-registration, mark as deleted)
    sb.table("wt_users").update({
        "plan": "basic",
        "security_code": None,
        "security_code_shown": False,
        "focus_consent": False,
        "focus_consent_withdrawn": True,
    }).eq("email", email).execute()

    return {"ok": True, "message": "All your data has been deleted. You can re-register with a new Lajtner Scope."}
"""


# ---------- [TASK 2] GDPR Data Export ----------

"""
@app.get("/auth/export-my-data")
async def export_my_data(email: str = ""):
    \"\"\"GDPR: Export all personal data for the user.
    Returns: measurements (LR, Lajtner Time, Point, Jerk, angle, speed, energy J+eV, dates),
    Focus Test answers, account info.\"\"\"
    from app.database import _sb
    import json as _json
    if not email:
        raise HTTPException(400, "email required")
    sb = _sb()

    # User info (exclude password_hash and security_code)
    user = _get_user(email)
    if not user:
        raise HTTPException(404, "User not found")
    user_safe = {
        "email": user.get("email"),
        "plan": user.get("plan"),
        "created_at": user.get("created_at"),
        "age_confirmed": user.get("age_confirmed"),
    }

    # Physics results (all measurements)
    phys_resp = sb.table("physics_results").select("*") \\
        .eq("user_email", email).order("created_at", desc=True).execute()
    measurements = []
    for r in (phys_resp.data or []):
        measurements.append({
            "date": r.get("created_at"),
            "job_id": r.get("job_id"),
            "medium": r.get("medium"),
            "direction": r.get("direction"),
            "duration_sec": r.get("duration_sec"),
            "cumulative_deg": r.get("cumulative_deg"),
            "omega_max": r.get("omega_max"),
            "F_max": r.get("F_max_air") or r.get("F_max_water"),
            "W_total_joules": r.get("W_total_air") or r.get("W_total_water"),
            "W_total_eV": (r.get("W_total_air") or r.get("W_total_water") or 0) / 1.602176634e-19,
            "P_peak": r.get("P_peak_air") or r.get("P_peak_water"),
            "planck_freq": r.get("planck_freq"),
            "lajtner_resonance": r.get("planck_freq"),  # LR = planck_freq
            "lajtner_time": r.get("lajtner_time"),
            "lajtner_point": r.get("lajtner_point"),
            "lajtner_jerk": r.get("a_lajtner"),
        })

    # Focus Test answers
    fq_resp = sb.table("focus_questionnaire").select("*") \\
        .eq("user_email", email).order("created_at", desc=True).execute()
    focus_answers = []
    for r in (fq_resp.data or []):
        focus_answers.append({
            "date": r.get("created_at"),
            "illness": r.get("illness"),
            "loneliness": r.get("loneliness"),
            "sleep": r.get("sleep"),
            "homeostasis": r.get("homeostasis"),
            "stimulants": r.get("stimulants"),
            "digital": r.get("digital"),
            "breathing": r.get("breathing"),
            "emotions": r.get("emotions"),
        })

    export = {
        "export_date": datetime.datetime.utcnow().isoformat(),
        "account": user_safe,
        "measurements": measurements,
        "focus_test_answers": focus_answers,
    }

    return export
"""


# ---------- [TASK 3] Focus Test Consent ----------

"""
@app.post("/questionnaire/consent")
async def questionnaire_consent(req: Request):
    \"\"\"GDPR: Give or withdraw consent for Focus Test data storage.\"\"\"
    from app.database import _sb
    body = await req.json()
    email = (body.get("email") or "").strip().lower()
    consent = body.get("consent", False)  # True = give, False = withdraw
    if not email:
        raise HTTPException(400, "email required")
    sb = _sb()
    if consent:
        sb.table("wt_users").update({
            "focus_consent": True,
            "focus_consent_at": datetime.datetime.utcnow().isoformat(),
            "focus_consent_withdrawn": False,
        }).eq("email", email).execute()
        return {"ok": True, "consent": True}
    else:
        # Withdraw — delete Focus Test data and block future use
        sb.table("focus_questionnaire").delete().eq("user_email", email).execute()
        sb.table("wt_users").update({
            "focus_consent": False,
            "focus_consent_withdrawn": True,
        }).eq("email", email).execute()
        return {"ok": True, "consent": False, "message": "Consent withdrawn. Your Focus Test data has been deleted."}
"""

"""
@app.get("/questionnaire/consent-status")
def questionnaire_consent_status(email: str = ""):
    \"\"\"Check user's Focus Test consent status.\"\"\"
    if not email: raise HTTPException(400, "email required")
    user = _get_user(email)
    if not user: raise HTTPException(404, "User not found")
    return {
        "consent": bool(user.get("focus_consent")),
        "withdrawn": bool(user.get("focus_consent_withdrawn")),
        "consent_at": user.get("focus_consent_at"),
    }
"""

# V SUSHCHESTVUYUSHCHEM endpoint POST /questionnaire — DOBAV' PROVERKU v nachalo:
"""
# Dobav' eti stroki POSLE "if not email: raise HTTPException(400, "email required")"

    # Check GDPR consent
    user = _get_user(email)
    if not user:
        raise HTTPException(404, "User not found")
    if not user.get("focus_consent"):
        raise HTTPException(403, "Focus Test requires explicit consent. Please provide consent first.")
    if user.get("focus_consent_withdrawn"):
        raise HTTPException(403, "You have withdrawn your Focus Test consent. This function is no longer available.")
"""


# ---------- [TASK 4] Focus Test Edit ----------

"""
@app.put("/questionnaire/update")
async def questionnaire_update(req: Request):
    \"\"\"Update user's Focus Test answers (e.g. stopped smoking).\"\"\"
    from app.database import _sb
    body = await req.json()
    email = (body.get("email") or "").strip().lower()
    if not email: raise HTTPException(400, "email required")

    user = _get_user(email)
    if not user or not user.get("focus_consent"):
        raise HTTPException(403, "Focus Test consent required")

    sb = _sb()
    # Get the latest response
    resp = sb.table("focus_questionnaire").select("*") \\
        .eq("user_email", email).order("created_at", desc=True).limit(1).execute()
    if not resp.data:
        raise HTTPException(404, "No questionnaire found to update")

    latest = resp.data[0]
    update_data = {}
    answered = 0
    for f in Q_FIELDS:
        v = body.get(f)
        if v is not None:
            update_data[f] = int(v)
        if (update_data.get(f) or latest.get(f, 0)) > 0:
            answered += 1
    update_data["answered_count"] = answered
    update_data["updated_at"] = datetime.datetime.utcnow().isoformat()

    sb.table("focus_questionnaire").update(update_data) \\
        .eq("id", latest["id"]).execute()
    return {"ok": True, "updated_id": latest["id"]}
"""


# ---------- [TASK 5] Age Confirmation on Registration ----------

# ZAMENI sushchestvuyushchiy /auth/register na:
"""
@app.post("/auth/register")
async def auth_register(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    recaptcha_token = body.get("recaptcha_token") or ""
    age_confirmed = body.get("age_confirmed", False)

    if not email or not password:
        raise HTTPException(400, "Email and password required")
    if not age_confirmed:
        raise HTTPException(400, "You must confirm that you are an adult where you live.")
    if not await _verify_recaptcha(recaptcha_token):
        raise HTTPException(400, "reCAPTCHA verification failed. Please try again.")
    if _get_user(email):
        raise HTTPException(409, "Email already registered")
    try:
        from app.database import _sb
        sb = _sb()
        sb.table("wt_users").insert({
            "email": email,
            "password_hash": _hash_pw(password),
            "plan": "basic",
            "created_at": datetime.datetime.utcnow().isoformat(),
            "age_confirmed": True,
        }).execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
"""


# ---------- [TASK 7] Shipping Restrictions ----------

# ZAMENI /store/shipping-estimate i dobav' proverku v /store/checkout:

ALLOWED_SHIPPING_REGIONS = {
    # country_code: list of allowed cities/states (None = whole country)
    "US": ["CA", "NY"],       # California, New York
    "NO": None,               # Norway — vsya strana
    "CH": None,               # Switzerland — vsya strana
    "GB": ["London"],         # UK — tol'ko London
}

def _check_shipping_allowed(country: str, state_or_city: str = ""):
    """Check if we ship hardware to this location."""
    country = (country or "").upper().strip()
    if country not in ALLOWED_SHIPPING_REGIONS:
        return False, f"We currently ship hardware only to the USA (California, New York City), Norway, Switzerland, and the UK (London). We do not ship to {country}."
    allowed = ALLOWED_SHIPPING_REGIONS[country]
    if allowed is None:
        return True, ""
    # Check state/city
    loc = (state_or_city or "").strip()
    if not loc:
        return True, ""  # Can't verify without city, allow and check manually
    loc_upper = loc.upper()
    for a in allowed:
        if a.upper() in loc_upper:
            return True, ""
    return False, f"We currently ship to {', '.join(allowed)} only in {country}. Please contact support for other locations."


# ZAMENI /store/shipping-estimate:
"""
@app.get("/store/shipping-estimate")
def store_shipping_estimate(country: str = "", postal_code: str = "",
                            city: str = "", state: str = "",
                            weight_kg: float = 0.3, has_hardware: bool = False):
    \"\"\"Estimate shipping cost. Hardware ships only to allowed regions.\"\"\"
    # If order contains hardware, check shipping restriction
    if has_hardware:
        allowed, msg = _check_shipping_allowed(country, state or city)
        if not allowed:
            raise HTTPException(400, msg)

    import os
    # Flat rates for allowed countries
    rates = {
        "US": 25.0,
        "NO": 30.0,
        "CH": 28.0,
        "GB": 20.0,
    }
    cost = rates.get(country.upper(), 35.0)
    if weight_kg > 1.0:
        cost += (weight_kg - 1.0) * 8

    return {
        "cost_usd": round(cost, 2),
        "source": "flat_rate",
        "allowed_regions": list(ALLOWED_SHIPPING_REGIONS.keys()),
        "note": "We ship hardware to USA (CA, NYC), Norway, Switzerland, UK (London) only."
    }
"""

# V /store/checkout — dobav' proverku posle zagruzki produktov:
"""
    # Check if order has hardware and validate shipping
    has_hardware = any(prods.get(i["product_id"], {}).get("type") == "physical" for i in items)
    if has_hardware and shipping_info:
        ship_country = shipping_info.get("country", "")
        ship_city = shipping_info.get("city", "")
        ship_state = shipping_info.get("state", "")
        allowed, msg = _check_shipping_allowed(ship_country, ship_state or ship_city)
        if not allowed:
            raise HTTPException(400, msg)
"""


# ---------- [TASK 8] Planck Disclaimer ----------
# Eto tol'ko frontend — sm. FAQ.jsx i PhysicsCard.jsx


# ---------- [TASK 9] Account / Measurement Profile ----------
# Eto tol'ko frontend terminology — sm. nizhe


# ═══════════════════════════════════════════════════════════════
# SUMMARY — chto gde menyat'
# ═══════════════════════════════════════════════════════════════

"""
BACKEND (main.py):

1. Dobav' funkciyu _generate_security_code()
2. Zameni /auth/register — dobav' age_confirmed
3. Zameni /auth/login — dobav' security code generaciyu
4. Dobav' POST /auth/delete-by-security-code
5. Dobav' GET /auth/export-my-data
6. Dobav' POST /questionnaire/consent
7. Dobav' GET /questionnaire/consent-status
8. Dobav' PUT /questionnaire/update
9. V POST /questionnaire — dobav' consent check
10. Dobav' ALLOWED_SHIPPING_REGIONS + _check_shipping_allowed()
11. Zameni GET /store/shipping-estimate
12. V POST /store/checkout — dobav' shipping restriction check

SQL:
- ALTER TABLE wt_users ADD COLUMN security_code TEXT;
- ALTER TABLE wt_users ADD COLUMN security_code_shown BOOLEAN DEFAULT FALSE;
- ALTER TABLE wt_users ADD COLUMN age_confirmed BOOLEAN DEFAULT FALSE;
- ALTER TABLE wt_users ADD COLUMN focus_consent BOOLEAN DEFAULT FALSE;
- ALTER TABLE wt_users ADD COLUMN focus_consent_at TIMESTAMPTZ;
- ALTER TABLE wt_users ADD COLUMN focus_consent_withdrawn BOOLEAN DEFAULT FALSE;
"""
