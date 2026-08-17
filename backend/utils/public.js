/* ---------- Public user shape ---------- */
/* What the API exposes about an account (id, profile + state/kyc blobs) —
   never the password hash, reset codes or session internals. */

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    emailVerified: !!u.emailVerified,
    state: u.state,
    kyc: u.kyc
  };
}

module.exports = { publicUser };
