# -*- coding: utf-8 -*-
"""
NTAG 424 DNA — SUN (Secure Unique NFC) crypto core.

Implements the standard NXP AN12196 SUN scheme for the common case:
  - encrypted PICC data mirror (UID + read counter)
  - CMAC mirror
  - one shared AES-128 key used for BOTH SDM Meta Read and SDM File Read
  - no extra encrypted file data (MAC computed over an empty message)

Two functions matter:
  simulate_sun(key, uid, counter)        -> (picc_hex, cmac_hex)   # acts like a real tag tap
  verify_sun(key, picc_hex, cmac_hex)    -> dict(uid, counter, valid)

So we can build & test the whole /verify flow now, WITHOUT a physical chip.
When real NTAG 424 DNA tags arrive (programmed with the same key + SUN), they
produce the same picc/cmac format and verify_sun() works unchanged.
"""
from Crypto.Cipher import AES
from Crypto.Hash import CMAC

PICC_TAG = 0xC7  # UID mirror (0x80) + read-counter (0x40) + UID length 7 (0x07)


def _cmac(key: bytes, msg: bytes) -> bytes:
    c = CMAC.new(key, ciphermod=AES)
    c.update(msg)
    return c.digest()


def _session_mac_key(key: bytes, uid: bytes, ctr_bytes: bytes) -> bytes:
    # SV2 per AN12196: 3Ch C3h 00h 01h 00h 80h || UID || RdCtr  (= 16 bytes)
    sv2 = bytes([0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]) + uid + ctr_bytes
    return _cmac(key, sv2)


def _truncate(mac16: bytes) -> bytes:
    # SDM truncation: take the odd-indexed bytes (1,3,5,...,15) -> 8 bytes
    return bytes(mac16[i] for i in range(1, 16, 2))


def simulate_sun(key: bytes, uid: bytes, counter: int) -> tuple[str, str]:
    """Produce (picc_hex, cmac_hex) exactly like a tag tap would. For testing."""
    assert len(key) == 16 and len(uid) == 7
    ctr_bytes = counter.to_bytes(3, "little")
    plain = bytes([PICC_TAG]) + uid + ctr_bytes          # 11 bytes
    plain += b"\x80" + b"\x00" * (16 - len(plain) - 1)    # pad to 16 (ignored on read)
    enc = AES.new(key, AES.MODE_CBC, iv=b"\x00" * 16).encrypt(plain)
    ks = _session_mac_key(key, uid, ctr_bytes)
    mac = _truncate(_cmac(ks, b""))                       # SUN: MAC over empty message
    return enc.hex().upper(), mac.hex().upper()


def verify_sun(key: bytes, picc_hex: str, cmac_hex: str) -> dict:
    """Decrypt PICC + verify CMAC. Returns uid (hex), counter, and valid flag."""
    try:
        enc = bytes.fromhex(picc_hex)
        given_mac = bytes.fromhex(cmac_hex)
    except ValueError:
        return {"valid": False, "error": "bad hex"}
    if len(enc) != 16:
        return {"valid": False, "error": "picc must be 16 bytes"}

    plain = AES.new(key, AES.MODE_CBC, iv=b"\x00" * 16).decrypt(enc)
    tag = plain[0]
    uid_len = tag & 0x0F
    uid = plain[1:1 + uid_len]
    ctr_bytes = plain[1 + uid_len:1 + uid_len + 3]
    counter = int.from_bytes(ctr_bytes, "little")

    ks = _session_mac_key(key, uid, ctr_bytes)
    expected = _truncate(_cmac(ks, b""))
    valid = (expected == given_mac) and bool(tag & 0x80)
    return {"valid": valid, "uid": uid.hex().upper(), "counter": counter}


if __name__ == "__main__":
    # ---- self-test: simulator <-> verifier round trip ----
    key = bytes.fromhex("00112233445566778899AABBCCDDEEFF")
    uid = bytes.fromhex("04A1B2C3D4E580")

    picc, cmac = simulate_sun(key, uid, counter=5)
    print("simulated tap -> picc:", picc, "cmac:", cmac)

    ok = verify_sun(key, picc, cmac)
    print("verify (correct):", ok)
    assert ok["valid"] and ok["uid"] == "04A1B2C3D4E580" and ok["counter"] == 5

    bad = verify_sun(key, picc, cmac[:-2] + "00")     # tampered cmac
    print("verify (tampered cmac):", bad)
    assert not bad["valid"]

    wrongkey = verify_sun(bytes(16), picc, cmac)       # wrong key
    print("verify (wrong key):", wrongkey)
    assert not wrongkey["valid"]

    p2, c2 = simulate_sun(key, uid, counter=6)         # next tap -> different output
    print("counter=6 -> picc:", p2, "cmac:", c2)
    assert p2 != picc and c2 != cmac

    print("\nALL CRYPTO TESTS PASSED")
