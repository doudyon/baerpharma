const CATALOG_URL = "https://baerpharmacy.allpharm.co.il/api/ProductSelection/getProductSelection";
const PHARMACY_ORIGIN = "https://baerpharmacy.allpharm.co.il";

function clean(value) {
  return String(value ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim();
}

function flatten(groups) {
  const products = [];

  for (const dosageGroup of groups || []) {
    for (const formGroup of dosageGroup.treatmentForm || []) {
      for (const item of formGroup.product || []) {
        const code = Number(item.code);
        const price = Number(item.price);
        if (!Number.isSafeInteger(code) || !Number.isFinite(price) || item.isInStock !== true) continue;

        const form = clean(item.treatmentForm || formGroup.treatmentForm);
        products.push({
          code,
          name: clean(item.nameHeb || item.name),
          brand: clean(item.brandHeb || item.brand),
          dosage: clean(item.activeIngredient || dosageGroup.dosage),
          form,
          price,
          priceBeforeSale: Number.isFinite(Number(item.priceBeforeSale)) ? Number(item.priceBeforeSale) : null,
          inStock: true,
          imageUrl: `${PHARMACY_ORIGIN}/assets/img/productDetails/itemImages/${code}.png`,
        });
      }
    }
  }

  return products.filter((product) => product.name);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(CATALOG_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        userid: PHARMACY_ORIGIN,
        Origin: PHARMACY_ORIGIN,
        Referer: `${PHARMACY_ORIGIN}/app/mobile/products-sale/orderOpen`,
      },
      body: JSON.stringify({ nameEnglish: null }),
      signal: controller.signal,
      redirect: "error",
    });

    if (!upstream.ok) {
      return res.status(502).json({ success: false, error: "Catalog provider returned an error" });
    }

    const payload = await upstream.json();
    if (payload?.success !== true || !Array.isArray(payload.value)) {
      return res.status(502).json({ success: false, error: "Unexpected catalog response" });
    }

    return res.status(200).json({
      success: true,
      updatedAt: new Date().toISOString(),
      products: flatten(payload.value),
    });
  } catch (error) {
    return res.status(502).json({ success: false, error: "Catalog is temporarily unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}
