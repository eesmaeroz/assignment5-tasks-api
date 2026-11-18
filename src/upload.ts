// Meryem Esma Eröz, 2200005798
// Bonus 12: the checks and the file handling for task attachments.

/** At most 1 MB per image. */
export const MAX_BYTES = 1_000_000;

/** The allowed types and the file extension each one is saved with. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

/** The first bytes of a real PNG or JPEG file ("magic numbers"). */
const SIGNATURES: Record<string, number[]> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

export const extensionFor = (type: string): string | undefined => EXTENSIONS[type];

/**
 * The content-type the client sends is only a claim (curl -F "file=@x.txt;type=image/png"
 * sends anything). So the bytes must also start like that kind of image.
 */
export function looksLike(bytes: Uint8Array, type: string): boolean {
  const signature = SIGNATURES[type];
  return signature !== undefined && signature.every((b, i) => bytes[i] === b);
}

/** The content-type for a saved name, from its extension (the name is always ours). */
export function typeOfSaved(name: string): string {
  return name.endsWith(".png") ? "image/png" : "image/jpeg";
}

/** A new name for every upload; the user's file name is never used on the disk. */
export const newName = (type: string) => `${crypto.randomUUID()}.${extensionFor(type)}`;

/** Remove a saved file; a file that is already gone is fine. */
export async function removeSaved(dir: string, name: string): Promise<void> {
  try {
    await Deno.remove(`${dir}/${name}`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
