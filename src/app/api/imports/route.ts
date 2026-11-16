import { api } from "@/server/http";
import { listBatches, uploadBatch } from "@/server/services/imports";
import { AppError } from "@/server/errors";
import { config } from "@/server/config";
import { rateLimit } from "@/server/auth/rateLimit";

export const GET = api(async ({ actor }) => ({ items: await listBatches(actor) }), { permission: "import:run" });

export const POST = api(
  async ({ req, actor }) => {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > config().IMPORT_MAX_BYTES + 64_000) throw new AppError("BAD_REQUEST", "File is too large.");
    const rl = rateLimit(`upload:${actor.id}`, 20, 10 * 60_000);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many uploads. Please wait a few minutes.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError("BAD_REQUEST", "Upload failed. Please choose the file again.");
    }
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "");
    if (!file || typeof file === "string") throw new AppError("VALIDATION", "Choose a file to upload.");
    if (file.size > config().IMPORT_MAX_BYTES) throw new AppError("BAD_REQUEST", "File is too large.");
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name.split(/[\\/]/).pop() ?? "upload.xlsx";
    return uploadBatch(actor, kind, name, buf);
  },
  { permission: "import:run" },
);
