import heroImg from '../assets/images/hero_indian_heritage_1794749766633.jpg';
import tajMahalImg from '../assets/images/monuments/taj-mahal.jpg';
import agraFortImg from '../assets/images/monuments/agra-fort.jpg';
import fatehpurSikriImg from '../assets/images/monuments/fatehpur-sikri.jpg';
import redFortImg from '../assets/images/monuments/red-fort.jpg';
import qutubMinarImg from '../assets/images/monuments/qutub-minar.jpg';
import humayunsTombImg from '../assets/images/monuments/humayuns-tomb.jpg';
import ajantaCavesImg from '../assets/images/monuments/ajanta-caves.jpg';
import elloraCavesImg from '../assets/images/monuments/ellora-caves.jpg';
import gatewayOfIndiaImg from '../assets/images/monuments/gateway-of-india.jpg';
import sanchiStupaImg from '../assets/images/monuments/sanchi-stupa.jpg';
import khajurahoTemplesImg from '../assets/images/monuments/khajuraho-temples.jpg';
import hampiImg from '../assets/images/monuments/hampi.jpg';
import golGumbazImg from '../assets/images/monuments/gol-gumbaz.jpg';
import konarkSunTempleImg from '../assets/images/monuments/konark-sun-temple.jpg';
import mahabalipuramImg from '../assets/images/monuments/mahabalipuram.jpg';
import amerFortImg from '../assets/images/monuments/amer-fort.jpg';
import chittorgarhFortImg from '../assets/images/monuments/chittorgarh-fort.jpg';
import charminarImg from '../assets/images/monuments/charminar.jpg';
import raniKiVavImg from '../assets/images/monuments/rani-ki-vav.jpg';
import jantarMantarJaipurImg from '../assets/images/monuments/jantar-mantar-jaipur.jpg';

export const HERO_PLATE_IMAGE = heroImg;

const MONUMENT_ARCHIVAL_IMAGES: Record<string, string> = {
  'taj-mahal': tajMahalImg,
  'agra-fort': agraFortImg,
  'fatehpur-sikri': fatehpurSikriImg,
  'red-fort': redFortImg,
  'qutub-minar': qutubMinarImg,
  'humayuns-tomb': humayunsTombImg,
  'ajanta-caves': ajantaCavesImg,
  'ellora-caves': elloraCavesImg,
  'gateway-of-india': gatewayOfIndiaImg,
  'sanchi-stupa': sanchiStupaImg,
  'khajuraho-temples': khajurahoTemplesImg,
  hampi: hampiImg,
  'gol-gumbaz': golGumbazImg,
  'konark-sun-temple': konarkSunTempleImg,
  mahabalipuram: mahabalipuramImg,
  'amer-fort': amerFortImg,
  'chittorgarh-fort': chittorgarhFortImg,
  charminar: charminarImg,
  'rani-ki-vav': raniKiVavImg,
  'jantar-mantar-jaipur': jantarMantarJaipurImg,
};

export function getMonumentArchivalImage(monumentId: string): string | null {
  return MONUMENT_ARCHIVAL_IMAGES[monumentId] ?? null;
}

export const FEATURED_MONUMENT_IDS = [
  'taj-mahal',
  'rani-ki-vav',
  'konark-sun-temple',
  'amer-fort',
] as const;
