import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "./review.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Prueba responsive | HoitLive Core",
  robots: { index: false, follow: false },
};

const sizes = [
  { width: 360, height: 800, label: "Móvil 360" },
  { width: 390, height: 844, label: "Móvil 390" },
  { width: 430, height: 932, label: "Móvil 430" },
  { width: 768, height: 1024, label: "Tablet 768" },
  { width: 1024, height: 768, label: "Horizontal 1024" },
];

export default async function ResponsiveReview({
  searchParams,
}: {
  searchParams: Promise<{ width?: string }>;
}) {
  // This is a preview-only wrapper, never an alternate authentication path.
  if (process.env.VERCEL_ENV === "production") notFound();
  const params = await searchParams;
  const size = sizes.find((item) => String(item.width) === params.width) ?? sizes[1];

  return (
    <main className={styles.review}>
      <header className={styles.toolbar}>
        <div>
          <h1>Prueba responsive</h1>
          <p>Viewport del portal: {size.width} × {size.height} px. Autenticación habitual.</p>
        </div>
        <nav aria-label="Tamaño de pantalla" className={styles.sizes}>
          {sizes.map((item) => (
            <a key={item.width} href={`?width=${item.width}`} aria-current={item.width === size.width ? "page" : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
      </header>
      <div className={styles.stage}>
        <iframe
          title={`Portal HoitLive Core a ${size.width} píxeles`}
          src="/"
          width={size.width}
          height={size.height}
          className={styles.portal}
        />
      </div>
    </main>
  );
}
