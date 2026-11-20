import { useEffect, useState } from 'react';
import { getMonumentArchivalImage } from '../lib/monumentMedia';
import type { ArchitecturalCategory } from '../types/heritage';

interface MonumentPlateProps {
  monumentId: string;
  monumentName: string;
  accessionCode: string;
  category: ArchitecturalCategory;
  className?: string;
}

function CategoryElevationSvg({ category }: { category: ArchitecturalCategory }) {
  const strokeColor = '#8B6624';
  const mutedStroke = '#C8A55B';

  switch (category) {
    case 'Mughal & Indo-Islamic':
      return (
        <svg viewBox="0 0 240 160" className="w-40 h-28" fill="none" aria-hidden="true">
          <path d="M24 138H216" stroke={mutedStroke} strokeWidth="1" />
          <path
            d="M72 138V88C72 68 92 56 120 42C148 56 168 68 168 88V138"
            stroke={strokeColor}
            strokeWidth="1.25"
          />
          <path
            d="M96 48C94 34 106 20 120 16C134 20 146 34 144 48"
            stroke={strokeColor}
            strokeWidth="1.25"
          />
          <path d="M120 8V16" stroke={strokeColor} strokeWidth="1.25" />
          <path d="M98 138V98C98 84 108 76 120 72C132 76 142 84 142 98V138" stroke={strokeColor} strokeWidth="1.1" />
          <path d="M46 138V58M54 138V58M186 138V58M194 138V58" stroke={mutedStroke} strokeWidth="1" />
          <path d="M43 58H57L50 48L43 58ZM183 58H197L190 48L183 58Z" stroke={strokeColor} strokeWidth="1" />
        </svg>
      );
    case 'Temple Architecture':
      return (
        <svg viewBox="0 0 240 160" className="w-40 h-28" fill="none" aria-hidden="true">
          <path d="M24 138H216" stroke={mutedStroke} strokeWidth="1" />
          <path d="M52 138V122H188V138" stroke={strokeColor} strokeWidth="1.2" />
          <path
            d="M84 122L92 84L102 52L120 22L138 52L148 84L156 122"
            stroke={strokeColor}
            strokeWidth="1.25"
          />
          <path d="M90 96H150M97 72H143M108 46H132" stroke={mutedStroke} strokeWidth="1" />
          <circle cx="120" cy="18" r="4" stroke={strokeColor} strokeWidth="1.2" />
          <path d="M108 122V94H132V122" stroke={strokeColor} strokeWidth="1.1" />
        </svg>
      );
    case 'Rock-Cut Caves':
      return (
        <svg viewBox="0 0 240 160" className="w-40 h-28" fill="none" aria-hidden="true">
          <path d="M24 138H216" stroke={mutedStroke} strokeWidth="1" />
          <path d="M36 138C40 82 58 38 120 34C182 38 200 82 204 138" stroke={mutedStroke} strokeWidth="1.1" />
          <path
            d="M84 138V92C84 68 100 54 120 54C140 54 156 68 156 92V138"
            stroke={strokeColor}
            strokeWidth="1.3"
          />
          <path
            d="M100 138V98C100 84 109 74 120 74C131 74 140 84 140 98V138"
            stroke={strokeColor}
            strokeWidth="1.1"
          />
          <path d="M62 138V82M178 138V82" stroke={strokeColor} strokeWidth="1.1" />
        </svg>
      );
    case 'Stepwells & Water Architecture':
      return (
        <svg viewBox="0 0 240 160" className="w-40 h-28" fill="none" aria-hidden="true">
          <path d="M28 42H212" stroke={strokeColor} strokeWidth="1.2" />
          <path d="M44 62H196M62 82H178M80 102H160M98 122H142" stroke={strokeColor} strokeWidth="1.1" />
          <path d="M44 42V122M196 42V122M80 62V122M160 62V122" stroke={mutedStroke} strokeWidth="1" />
          <path d="M98 136H142" stroke={strokeColor} strokeWidth="1.2" />
        </svg>
      );
    case 'Forts & Palaces':
      return (
        <svg viewBox="0 0 240 160" className="w-40 h-28" fill="none" aria-hidden="true">
          <path d="M24 138H216" stroke={mutedStroke} strokeWidth="1" />
          <path
            d="M44 138V68H58V78H72V68H86V78H100V68H140V78H154V68H168V78H182V68H196V138"
            stroke={strokeColor}
            strokeWidth="1.25"
          />
          <path d="M104 138V102C104 90 112 84 120 80C128 84 136 90 136 102V138" stroke={strokeColor} strokeWidth="1.2" />
          <path d="M66 96H76V112H66V96ZM164 96H174V112H164V96Z" stroke={mutedStroke} strokeWidth="1" />
        </svg>
      );
    case 'Astronomical Observatories':
      return (
        <svg viewBox="0 0 240 160" className="w-40 h-28" fill="none" aria-hidden="true">
          <path d="M24 138H216" stroke={mutedStroke} strokeWidth="1" />
          <path d="M54 138L142 36V138" stroke={strokeColor} strokeWidth="1.3" />
          <path d="M108 138A48 48 0 0 1 186 102" stroke={strokeColor} strokeWidth="1.2" />
          <circle cx="152" cy="76" r="22" stroke={mutedStroke} strokeWidth="1" strokeDasharray="3 3" />
        </svg>
      );
    case 'Buddhist Monuments':
      return (
        <svg viewBox="0 0 240 160" className="w-40 h-28" fill="none" aria-hidden="true">
          <path d="M24 138H216" stroke={mutedStroke} strokeWidth="1" />
          <path d="M58 138C58 84 84 56 120 56C156 56 182 84 182 138" stroke={strokeColor} strokeWidth="1.3" />
          <rect x="108" y="42" width="24" height="14" stroke={strokeColor} strokeWidth="1.1" />
          <path d="M120 26V42M110 30H130M113 35H127" stroke={strokeColor} strokeWidth="1.1" />
          <path d="M40 138V114H200V138" stroke={mutedStroke} strokeWidth="1" />
        </svg>
      );
    case 'Civic & Colonial Landmarks':
    default:
      return (
        <svg viewBox="0 0 240 160" className="w-40 h-28" fill="none" aria-hidden="true">
          <path d="M24 138H216" stroke={mutedStroke} strokeWidth="1" />
          <path d="M52 138V62H188V138" stroke={strokeColor} strokeWidth="1.25" />
          <path d="M92 138V92C92 76 104 68 120 68C136 68 148 76 148 92V138" stroke={strokeColor} strokeWidth="1.25" />
          <path d="M46 62H194M72 46H168V62H72V46Z" stroke={mutedStroke} strokeWidth="1" />
        </svg>
      );
  }
}

export function MonumentPlate({
  monumentId,
  monumentName,
  accessionCode,
  category,
  className = '',
}: MonumentPlateProps) {
  const imageSrc = getMonumentArchivalImage(monumentId);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [imageSrc]);

  if (imageSrc && !imageError) {
    return (
      <div className={`relative overflow-hidden bg-[#EFE9DC] ${className}`}>
        <img
          src={imageSrc}
          alt={`${monumentName} photograph`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#F5EFE3] to-[#EBE2D1] px-6 py-8 text-center ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-3 border border-[#D8CCB7]/80"
        aria-hidden="true"
      />
      <CategoryElevationSvg category={category} />
      <p className="mt-3 font-mono text-[11px] tracking-wider text-[#695547] uppercase tabular-nums">
        {accessionCode} · Monograph Plate
      </p>
      <p className="mt-0.5 text-xs text-[#7D5A1C]">
        Reference photograph pending ingestion
      </p>
    </div>
  );
}
