const mongoose = require('mongoose');

/**
 * What the user sells and to whom. Everything about a lead is judged against
 * this: the gates (lib/leads/gates.js) match services and exclusions, the score
 * weighs budget and place, the sources build their searches from service
 * keywords, and a first line may cite only the proof and cases saved here.
 *
 * Packages, UPI and GST belong to Proposals and Invoices and live there later.
 */
const CLIENT_TYPES = ['startups', 'agencies', 'local-business', 'ecommerce', 'saas', 'nonprofit', 'enterprise'];
const COMPANY_SIZES = ['1-10', '11-50', '51-200', '200+'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
const LIMITS = { services: 10, keywords: 15, locations: 10, exclusions: 30, proof: 10, cases: 10 };

const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  // What a post has to mention for this service to match. Lowercase.
  keywords: { type: [String], default: [] },
  // Smallest job worth taking for this service; 0 = use the profile's minProject.
  minBudget: { type: Number, default: 0, min: 0 },
}, { _id: false });

const profileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },

  name: { type: String, default: '', trim: true, maxlength: 80 },
  headline: { type: String, default: '', trim: true, maxlength: 140 },
  // For the first email: the one link it carries when no case has its own, a line on
  // how you work, and when you can start. All optional.
  portfolioUrl: { type: String, default: '', trim: true, maxlength: 300 },
  howIWork: { type: String, default: '', trim: true, maxlength: 160 },
  availability: { type: String, default: '', trim: true, maxlength: 80 },
  // Under your name in the first email, with your site. Optional.
  phone: { type: String, default: '', trim: true, maxlength: 30 },

  services: { type: [serviceSchema], default: [] },

  currency: { type: String, enum: CURRENCIES, default: 'INR' },
  rate: { type: Number, default: 0, min: 0 },        // per hour
  minProject: { type: Number, default: 0, min: 0 },  // smallest project worth taking

  clientTypes: { type: [{ type: String, enum: CLIENT_TYPES }], default: [] },
  companySizes: { type: [{ type: String, enum: COMPANY_SIZES }], default: [] },
  // Where clients may be: 'india', 'us', 'uk', … or a city. Lowercase.
  locations: { type: [String], default: [] },
  remoteOk: { type: Boolean, default: true },

  // A post containing any of these is dropped (lowercase phrases).
  exclusions: { type: [String], default: [] },

  proof: { type: [{ who: { type: String, maxlength: 80 }, text: { type: String, maxlength: 400 }, _id: false }], default: [] },
  // Past work. `service`: which of your services it proves — the first email cites the
  // case that matches the lead's service (lib/outreach/cases.js).
  cases: { type: [{ title: { type: String, maxlength: 120 }, result: { type: String, maxlength: 300 }, url: { type: String, maxlength: 300 },
    service: { type: String, maxlength: 80, default: '' }, client: { type: String, maxlength: 80, default: '' }, _id: false }], default: [] },

  // Proposals: how payment is split (start / halfway / delivery, in %), rounds of
  // changes included, and how long a proposal stays open.
  proposalTerms: {
    split: { type: [Number], default: [30, 40, 30] },
    rounds: { type: Number, default: 2, min: 0, max: 10 },
    validDays: { type: Number, default: 14, min: 1, max: 90 },
  },

  // Getting paid: what invoices show. GST only if you're registered (over ₹20 lakh
  // a year it's required); UPI for Indian clients, bank/PayPal/Wise text for others.
  billing: {
    legalName: { type: String, default: '', trim: true, maxlength: 160 },
    address: { type: String, default: '', trim: true, maxlength: 500 },
    taxId: { type: String, default: '', trim: true, maxlength: 40 },        // PAN or GSTIN
    gstPercent: { type: Number, default: 0, min: 0, max: 28 },
    upiId: { type: String, default: '', trim: true, maxlength: 120 },
    payDetails: { type: String, default: '', trim: true, maxlength: 800 }, // bank / PayPal / Wise
    prefix: { type: String, default: 'INV', trim: true, maxlength: 12 },
    paymentDays: { type: Number, default: 7, min: 0, max: 90 },
  },

  // Which sources run for this account, and how many web searches a day.
  sources: {
    hn: { type: Boolean, default: true },
    news: { type: Boolean, default: true },
    web: { type: Boolean, default: true },
    webPerDay: { type: Number, default: 5, min: 1, max: 20 },
  },
}, { timestamps: true });

profileSchema.index({ userId: 1 }, { unique: true });

/** What is still missing before leads can be judged; [] when the profile is usable. */
function missingFor(p) {
  const missing = [];
  if (!p || !(p.services || []).some(s => s.name && (s.keywords || []).length)) missing.push('a service with keywords');
  if (!p || !(p.minProject > 0)) missing.push('your smallest project');
  if (!p || (!(p.locations || []).length && !p.remoteOk)) missing.push('where your clients can be');
  return missing;
}

/** The account's profile, created on first use. */
profileSchema.statics.forUser = function forUser(userId) {
  return this.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
};

const Profile = mongoose.model('Profile', profileSchema);
module.exports = Profile;
Object.assign(module.exports, { CLIENT_TYPES, COMPANY_SIZES, CURRENCIES, LIMITS, missingFor });
