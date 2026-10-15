import type { Metadata } from "next";
import "../src/styles.css";
import "uplot/dist/uPlot.min.css";

export const metadata: Metadata = {
  title: "Ability Lab v0.1",
  description: "Ability Lab research instrument prototype",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
