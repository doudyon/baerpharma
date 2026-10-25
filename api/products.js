const API_ORIGIN = "https://easycannabis.co.il";
const PHARMACY_PATH = "/api/pharms/hadov-hagdol/pharm-products";

export const config = {
  maxDuration: 60,
};

function clean(value) {
  return String(value ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
}

function categoryOf(form) {
  if (form.includes("שמן")) return "oils";
  if (form.includes("גליל")) return "rolls";
  if (form.includes("תפרחת")) return "flowers";
  return "other";
}

function flatten(items) {
  return (items || []).flatMap((item) => {
    const product = item.product || {};
    const info = product.info || {};
    const id = Number(item.id);
    const price = Number(item.price ?? item.totalPrice);
    const form = clean(product.shortName);
    const imagePath = product.imageUrl || product.media?.find((media) => media.type === "image")?.url;

    if (!Number.isSafeInteger(id) || !Number.isFinite(price) || item.inStock !== true || item.published === false || product.published === false || !product.name) return [];

    return [{
      code: id,
      name: clean(product.name),
      brand: clean(info.brandHeb || info.company || info.producerName),
      dosage: clean(info.thccbdDosage),
      form,
      category: categoryOf(form),
      price,
      before: Number.isFinite(Number(item.originalPrice)) ? Number(item.originalPrice) : null,
      inStock: true,
      imageUrl: imagePath ? new URL(imagePath, API_ORIGIN).toString() : null,
    }];
  });
}

function apiHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    "x-api-key": process.env.EASYCANNABIS_API_KEY,
    "x-app-id": "easycannabis-website-frontend",
    "x-app-version": "6e748cbe22d65b6b8955fba1db0b178d",
    Referer: "https://easycannabis.co.il/pharms/hadov-hagdol",
  };
}

async function fetchPage(page, signal) {
  const response = await fetch(`${API_ORIGIN}${PHARMACY_PATH}?page=${page}`, {
    headers: apiHeaders(),
    signal,
  });
  if (!response.ok) throw new Error(`Catalog provider returned ${response.status}`);
  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!process.env.EASYCANNABIS_API_KEY) {
    return res.status(503).json({ success: false, error: "Catalog is not configured" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const first = await fetchPage(1, controller.signal);
    if (!Array.isArray(first?.pharmProducts)) throw new Error("Unexpected catalog response");

    const total = Number(first.total);
    const perPage = Number(first.perPage);
    const pageCount = Number.isFinite(total) && Number.isFinite(perPage) && perPage > 0
      ? Math.min(Math.ceil(total / perPage), 20)
      : 1;

    const remaining = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(index + 2, controller.signal)),
    );

    const pages = [first, ...remaining];
    if (pages.some((page) => !Array.isArray(page?.pharmProducts))) throw new Error("Unexpected catalog response");

    const products = flatten(pages.flatMap((page) => page.pharmProducts));
    return res.status(200).json({
      success: true,
      updatedAt: new Date().toISOString(),
      source: "EasyCannabis",
      total: products.length,
      products,
    });
  } catch (error) {
    console.error("EasyCannabis catalog request failed", {
      name: error?.name || "Error",
      message: error?.message || "Unknown error",
      cause: error?.cause?.code || error?.cause?.message || undefined,
    });
    return res.status(502).json({ success: false, error: "Catalog is temporarily unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}
