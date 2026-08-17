import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Air Canvas",
  description:
    "Draw your idea in the air. Let AI bring it to life. A computer vision + generative AI stage demonstration.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden bg-[#050510] text-white">
        {children}
      </body>
    </html>
  );
}
