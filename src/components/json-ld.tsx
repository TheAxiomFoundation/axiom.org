import { serializeJsonLd } from "@/lib/json-ld";

/**
 * The one place the site writes a JSON-LD block. Pages pass the object;
 * serializeJsonLd escapes it so request- or corpus-supplied text can
 * never close the script element (see src/lib/json-ld.ts).
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
