/* ---------- Request validation (zod) ---------- */
/* validate(schema) runs the schema against body + params + query, strips
   control chars from every string, and returns 400 with a human message on
   mismatch — never leaks internal detail. All schemas live here, away from the
   security middleware. */

const { z } = require('zod');
const { sanitizeStrings } = require('./security');

function validate(schema) {
  return (req, res, next) => {
    const r = schema.safeParse({ ...(req.body || {}), ...req.params, ...req.query });
    if (!r.success) {
      const issue = r.error.issues[0];
      const msg = issue && issue.message ? issue.message : 'Invalid request';
      return res.status(400).json({ error: msg });
    }
    req.valid = sanitizeStrings(r.data);
    next();
  };
}

const EMAIL = z.string().trim().toLowerCase()
  .min(3).max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Enter a valid email');
const PASSWORD = z.string().min(6, 'Password must be 6+ characters').max(128, 'Password is too long');

const schemas = {
  register: z.object({
    name: z.string().trim().max(100, 'Name is too long').optional().default(''),
    email: EMAIL,
    phone: z.string().trim().max(30, 'Phone is too long').optional().default(''),
    password: PASSWORD
  }),
  login: z.object({
    email: EMAIL,
    password: z.string().min(1, 'Enter your password').max(128)
  }),
  verify: z.object({
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email')
  }),
  forgot: z.object({ email: EMAIL }),
  reset: z.object({
    email: EMAIL,
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
    password: PASSWORD
  }),
  changePassword: z.object({
    current: z.string().min(1, 'Enter your current password').max(128),
    next: PASSWORD
  }),
  id: z.object({
    id: z.coerce.number().int().positive()
  }),
  adminState: z.object({
    id: z.coerce.number().int().positive()
  }),
  kycLevel: z.object({
    level: z.coerce.number().int().min(1).max(3),
    verified: z.boolean().optional().default(false)
  }),
  kycUpload: z.object({
    level: z.coerce.number().int().refine(l => l === 2 || l === 3, 'Bad level'),
    docType: z.string().trim().max(60).optional().default(''),
    fileName: z.string().trim().max(200).optional().default(''),
    fileSize: z.coerce.number().int().min(0).max(100 * 1024 * 1024).optional().default(0),
    fileData: z.string().startsWith('data:', 'Missing file data').max(30 * 1024 * 1024)
  }),
  adminLogin: z.object({
    password: z.string().min(1).max(200)
  }),
  adminCreateUser: z.object({
    name: z.string().trim().max(100).optional().default(''),
    email: EMAIL,
    phone: z.string().trim().max(30).optional().default(''),
    password: PASSWORD
  }),
  adminKyc: z.object({
    id: z.coerce.number().int().positive(),
    level: z.coerce.number().int().min(1).max(3),
    verified: z.boolean().optional().default(false)
  }),
  adminEmail: z.object({
    id: z.coerce.number().int().positive(),
    template: z.enum(['welcome', 'verify-code', 'kyc-verified', 'custom']).default('custom'),
    subject: z.string().trim().max(200).optional().default(''),
    message: z.string().trim().max(20000).optional().default('')
  }),
  adminListUsers: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
    q: z.string().trim().max(100).optional().default('')
  }),
  /* Server-authoritative deposit/withdrawal request (idempotent via clientId). */
  submitTx: z.object({
    type: z.enum(['deposit', 'withdrawal']),
    asset: z.string().trim().min(1).max(40),
    amount: z.coerce.number().positive().max(100000000, 'Amount is too large'),
    to: z.string().trim().max(300).optional().default(''),
    clientId: z.string().trim().max(64).optional().default('')
  }),
  /* Admin approves/declines a pending tx: /users/:id/tx/:txId/{approve,decline} */
  adminTxAction: z.object({
    id: z.coerce.number().int().positive(),
    txId: z.string().trim().min(1).max(64)
  })
};

module.exports = { validate, schemas };
