import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractPropertyFromUrl } from "./property-import.server";

export const importPropertyFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { values, missing_fields } = await extractPropertyFromUrl(data.url);

    const { data: saved, error } = await supabase
      .from("properties")
      .insert({
        user_id: userId,
        ...values,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    return { property: saved, missing_fields };
  });
