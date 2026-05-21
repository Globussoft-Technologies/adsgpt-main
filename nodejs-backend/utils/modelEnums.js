// Derived from the model registry — the registry is the single source of
// truth for what counts as a generation model.
const { imageEntries, videoEntries } = require("../config/modelRegistry");

const GENERATED_MEDIA_MODELS = [
    ...imageEntries().map((e) => e.canonicalKey),
    ...videoEntries().map((e) => e.canonicalKey),
];

// const validateModel = (model) => {
//   if (!GENERATED_MEDIA_MODELS.includes(model)) {
//     throw new Error("Invalid model");
//   }
// };

module.exports = {
    GENERATED_MEDIA_MODELS
};
