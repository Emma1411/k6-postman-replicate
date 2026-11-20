import sharp from "sharp";
import { rename } from "node:fs/promises";

const input = "src/app/icon.png";
const output = "src/app/icon.trimmed.png";

const trimmed = await sharp(input).trim({ threshold: 10 }).toBuffer();

await sharp(trimmed)
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(output);

await rename(output, input);
console.log("icon.png rogné et recompressé");