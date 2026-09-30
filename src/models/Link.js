const { Schema, model } = require('mongoose');

const linkSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    type: { type: String, enum: ['url', 'whatsapp'], required: true },
    // Destino ya resuelto: el redirect es una sola lectura, sin lógica extra.
    target: { type: String, required: true },
    label: { type: String, default: '', maxlength: 100 },
    clicks: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = model('Link', linkSchema);
