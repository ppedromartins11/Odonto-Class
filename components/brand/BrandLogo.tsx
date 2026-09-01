import Image from "next/image";

type BrandLogoProps = {
  variant?: "full" | "mark";
  className?: string;
  priority?: boolean;
};

const assets = {
  full: {
    src: "/brand/odonto-class-logo.png",
    width: 1015,
    height: 650,
    alt: "Odonto Class — Clínica Odontológica",
  },
  mark: {
    src: "/brand/odonto-class-mark.png",
    width: 430,
    height: 400,
    alt: "Odonto Class",
  },
} as const;

export function BrandLogo({ variant = "full", className = "", priority = false }: BrandLogoProps) {
  const asset = assets[variant];
  return <Image src={asset.src} width={asset.width} height={asset.height} alt={asset.alt} className={`h-auto object-contain ${className}`} priority={priority} sizes={variant === "full" ? "(max-width: 640px) 75vw, 288px" : "48px"} />;
}
