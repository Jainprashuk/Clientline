const mongoose = require('mongoose');

/** Per-user sequences (invoice numbers): one atomic $inc, so two invoices never share a number. */
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  key: { type: String, required: true },
  seq: { type: Number, default: 0 },
}, { versionKey: false });
schema.index({ userId: 1, key: 1 }, { unique: true });

const Counter = mongoose.model('Counter', schema);

/** The next number in a sequence (1, 2, 3 …). */
Counter.next = async (userId, key) => (await Counter.findOneAndUpdate({ userId, key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }).lean()).seq;

module.exports = Counter;
