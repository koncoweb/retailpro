import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeGeneratorProps {
  value: string;
  format?: string;
  width?: number;
  height?: number;
  displayValue?: boolean;
  fontSize?: number;
  className?: string;
}

export const BarcodeGenerator = ({
  value,
  format = "CODE128",
  width = 1.5,
  height = 40,
  displayValue = true,
  fontSize = 12,
  className
}: BarcodeGeneratorProps) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: format,
          width: width,
          height: height,
          displayValue: displayValue,
          fontSize: fontSize,
          // Quiet zones keep adjacent text/packaging out of the decoder's scan.
          margin: 8,
          marginLeft: Math.ceil(width * 10),
          marginRight: Math.ceil(width * 10),
          lineColor: "#000000",
          background: "#ffffff",
        });
      } catch (error) {
        console.error("Barcode generation failed:", error);
      }
    }
  }, [value, format, width, height, displayValue, fontSize]);

  return (
    <div className={className}>
      <svg ref={svgRef} role="img" aria-label={`Barcode ${value}`} />
    </div>
  );
};
