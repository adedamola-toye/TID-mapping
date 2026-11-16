import { api, xlsxResponse } from "@/server/http";
import { importTemplate } from "@/server/services/imports";
import { IMPORT_KINDS, type ImportKind } from "@/lib/constants";
import { AppError } from "@/server/errors";

export const GET = api(
  async ({ req }) => {
    const kind = req.nextUrl.searchParams.get("kind") as ImportKind;
    if (!IMPORT_KINDS.includes(kind)) throw new AppError("BAD_REQUEST", "Unknown template.");
    return xlsxResponse(await importTemplate(kind), `wakeel-template-${kind.toLowerCase()}.xlsx`);
  },
  { permission: "import:run" },
);
