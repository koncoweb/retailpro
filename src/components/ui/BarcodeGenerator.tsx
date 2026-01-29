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
          margin: 0,
          background: "transparent",
        });
      } catch (error) {
        console.error("Barcode generation failed:", error);
      }
    }
  }, [value, format, width, height, displayValue, fontSize]);

  return (
    <div className={className}>
      <svg ref={svgRef} />
    </div>
  );
};
