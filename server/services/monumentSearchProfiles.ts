export interface MonumentSearchProfile {
  siteId: string;
  folderName: string;
  monumentName: string;
  state: string;
  categories: string[];
  queries: string[];
  negativeKeywords: string[];
}

export const MONUMENT_SEARCH_PROFILES: MonumentSearchProfile[] = [
  {
    siteId: 'taj-mahal',
    folderName: 'Taj_Mahal',
    monumentName: 'Taj Mahal',
    state: 'Uttar Pradesh',
    categories: ['Category:Taj Mahal', 'Category:Taj Mahal interior', 'Category:Taj Mahal garden'],
    queries: [
      'Taj Mahal Agra exterior marble',
      'Taj Mahal Agra facade dome minaret',
      'Taj Mahal mosque jawab courtyard entrance',
    ],
    negativeKeywords: ['bibi ka maqbara', 'replica', 'lego', 'cake', 'cartoon'],
  },
  {
    siteId: 'agra-fort',
    folderName: 'Agra_Fort',
    monumentName: 'Agra Fort',
    state: 'Uttar Pradesh',
    categories: ['Category:Agra Fort', 'Category:Jahangiri Mahal, Agra Fort', 'Category:Diwan-i-Khas (Agra Fort)'],
    queries: [
      'Agra Fort Red Fort Agra sandstone',
      'Agra Fort Diwan-i-Am Diwan-i-Khas',
      'Agra Fort Amar Singh Gate Jahangiri Mahal courtyard',
    ],
    negativeKeywords: ['red fort delhi', 'lal qila delhi'],
  },
  {
    siteId: 'fatehpur-sikri',
    folderName: 'Fatehpur_Sikri',
    monumentName: 'Fatehpur Sikri',
    state: 'Uttar Pradesh',
    categories: ['Category:Fatehpur Sikri', 'Category:Buland Darwaza', 'Category:Panch Mahal, Fatehpur Sikri'],
    queries: [
      'Fatehpur Sikri Buland Darwaza Agra',
      'Fatehpur Sikri Panch Mahal Jama Masjid',
      'Fatehpur Sikri Diwan-i-Khas courtyard carving',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'red-fort',
    folderName: 'Red_Fort',
    monumentName: 'Red Fort',
    state: 'Delhi',
    categories: ['Category:Red Fort', 'Category:Lahori Gate (Red Fort)', 'Category:Diwan-i-Khas (Red Fort)'],
    queries: [
      'Red Fort Lal Qila Delhi',
      'Red Fort Delhi Lahori Gate ramparts',
      'Red Fort Delhi Diwan-i-Aam Rang Mahal interior',
    ],
    negativeKeywords: ['agra fort', 'red fort of agra'],
  },
  {
    siteId: 'qutub-minar',
    folderName: 'Qutub_Minar',
    monumentName: 'Qutub Minar',
    state: 'Delhi',
    categories: ['Category:Qutb Minar', 'Category:Qutb complex', 'Category:Alai Darwaza'],
    queries: [
      'Qutub Minar Qutb Minar Delhi',
      'Qutub Minar Alai Darwaza Quwwat-ul-Islam mosque',
      'Qutb Minar carvings Iron Pillar Delhi',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'humayuns-tomb',
    folderName: 'Humayuns_Tomb',
    monumentName: "Humayun's Tomb",
    state: 'Delhi',
    categories: ["Category:Humayun's Tomb, Delhi", "Category:Humayun's Tomb complex"],
    queries: [
      "Humayun's Tomb Delhi Charbagh dome",
      'Humayun Tomb Delhi Isa Khan gateway',
      'Humayun Tomb Nizamuddin facade marble',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'ajanta-caves',
    folderName: 'Ajanta_Caves',
    monumentName: 'Ajanta Caves',
    state: 'Maharashtra',
    categories: ['Category:Ajanta Caves', 'Category:Sculptures in Ajanta Caves'],
    queries: [
      'Ajanta Caves Maharashtra rock-cut facade',
      'Ajanta Caves chaitya hall sculpture interior',
      'Ajanta Caves Aurangabad Buddhist monastery',
    ],
    negativeKeywords: ['ellora'],
  },
  {
    siteId: 'ellora-caves',
    folderName: 'Ellora_Caves',
    monumentName: 'Ellora Caves',
    state: 'Maharashtra',
    categories: ['Category:Ellora Caves', 'Category:Kailasa temple, Ellora'],
    queries: [
      'Ellora Caves Kailasa Temple Maharashtra',
      'Ellora Caves Verul rock-cut sculpture',
      'Ellora Caves courtyard carving facade',
    ],
    negativeKeywords: ['ajanta'],
  },
  {
    siteId: 'gateway-of-india',
    folderName: 'Gateway_of_India',
    monumentName: 'Gateway of India',
    state: 'Maharashtra',
    categories: ['Category:Gateway of India'],
    queries: [
      'Gateway of India Mumbai Apollo Bunder',
      'Gateway of India basalt arch facade',
      'Gateway of India waterfront detail',
    ],
    negativeKeywords: ['india gate delhi', 'india gate new delhi'],
  },
  {
    siteId: 'sanchi-stupa',
    folderName: 'Sanchi_Stupa',
    monumentName: 'Sanchi Stupa',
    state: 'Madhya Pradesh',
    categories: ['Category:Great Stupa at Sanchi', 'Category:Toranas at Sanchi'],
    queries: [
      'Sanchi Stupa Great Stupa Madhya Pradesh',
      'Sanchi Stupa torana gateway carving',
      'Sanchi Buddhist monuments dome railing',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'khajuraho-temples',
    folderName: 'Khajuraho_Temples',
    monumentName: 'Khajuraho Temples',
    state: 'Madhya Pradesh',
    categories: ['Category:Khajuraho group of monuments', 'Category:Kandariya Mahadeva Temple'],
    queries: [
      'Khajuraho temples Kandariya Mahadeva',
      'Khajuraho Chhatarpur sculpture shikhara',
      'Khajuraho Lakshmana Vishvanatha temple carving',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'hampi',
    folderName: 'Hampi',
    monumentName: 'Hampi',
    state: 'Karnataka',
    categories: ['Category:Group of Monuments at Hampi', 'Category:Vittala Temple, Hampi', 'Category:Virupaksha Temple, Hampi'],
    queries: [
      'Hampi Vittala Temple Stone Chariot',
      'Hampi Virupaksha Temple Vijayanagara gopuram',
      'Hampi Lotus Mahal Elephant Stables Karnataka',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'gol-gumbaz',
    folderName: 'Gol_Gumbaz',
    monumentName: 'Gol Gumbaz',
    state: 'Karnataka',
    categories: ['Category:Gol Gumbaz'],
    queries: [
      'Gol Gumbaz Bijapur Vijayapura dome',
      'Gol Gumbad mausoleum Adil Shahi towers',
      'Gol Gumbaz gallery interior facade',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'konark-sun-temple',
    folderName: 'Konark_Sun_Temple',
    monumentName: 'Konark Sun Temple',
    state: 'Odisha',
    categories: ['Category:Konark Sun Temple', 'Category:Wheels of Konark Sun Temple'],
    queries: [
      'Konark Sun Temple Konarak Odisha',
      'Konark Sun Temple stone chariot wheel carving',
      'Konark Sun Temple Natamandira Puri sculpture',
    ],
    negativeKeywords: ['modhera'],
  },
  {
    siteId: 'mahabalipuram',
    folderName: 'Mahabalipuram',
    monumentName: 'Mahabalipuram',
    state: 'Tamil Nadu',
    categories: ['Category:Group of Monuments at Mahabalipuram', 'Category:Shore Temple', 'Category:Pancha Rathas'],
    queries: [
      'Mahabalipuram Shore Temple Mamallapuram',
      'Mahabalipuram Pancha Rathas rock-cut',
      'Mahabalipuram Descent of the Ganges relief carving',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'amer-fort',
    folderName: 'Amer_Fort',
    monumentName: 'Amer Fort',
    state: 'Rajasthan',
    categories: ['Category:Amber Fort', 'Category:Sheesh Mahal (Amber Fort)'],
    queries: [
      'Amer Fort Amber Palace Jaipur',
      'Amber Fort Jaipur Maota Lake ramparts',
      'Amer Fort Ganesh Pol Sheesh Mahal courtyard',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'chittorgarh-fort',
    folderName: 'Chittorgarh_Fort',
    monumentName: 'Chittorgarh Fort',
    state: 'Rajasthan',
    categories: ['Category:Chittorgarh Fort', 'Category:Vijaya Stambha'],
    queries: [
      'Chittorgarh Fort Vijay Stambha Rajasthan',
      'Chittor Fort Rana Kumbha Palace Padmini',
      'Chittorgarh Kirti Stambha hill fort gateway',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'charminar',
    folderName: 'Charminar',
    monumentName: 'Charminar',
    state: 'Telangana',
    categories: ['Category:Charminar'],
    queries: [
      'Charminar Hyderabad Telangana arches',
      'Charminar minarets facade evening',
      'Charminar Old City Hyderabad detail',
    ],
    negativeKeywords: [],
  },
  {
    siteId: 'rani-ki-vav',
    folderName: 'Rani_ki_Vav',
    monumentName: 'Rani Ki Vav',
    state: 'Gujarat',
    categories: ['Category:Rani ki vav'],
    queries: [
      'Rani ki vav Patan Gujarat stepwell',
      "Queen's Stepwell Patan pavilion sculptures",
      'Rani ki vav pillars carvings stairs',
    ],
    negativeKeywords: ['adalaj', 'chand baori'],
  },
  {
    siteId: 'jantar-mantar-jaipur',
    folderName: 'Jantar_Mantar_Jaipur',
    monumentName: 'Jantar Mantar Jaipur',
    state: 'Rajasthan',
    categories: ['Category:Jantar Mantar (Jaipur)', 'Category:Samrat Yantra, Jantar Mantar (Jaipur)'],
    queries: [
      'Jantar Mantar Jaipur observatory Samrat Yantra',
      'Jantar Mantar Jaipur astronomical instruments',
      'Jantar Mantar Jaipur Jai Prakash Rashivalaya',
    ],
    negativeKeywords: ['jantar mantar delhi', 'new delhi', 'ujjain'],
  },
];

export const UNKNOWN_DISTRACTOR_PROFILE: MonumentSearchProfile = {
  siteId: 'unknown',
  folderName: 'unknown',
  monumentName: 'Unknown / Non-Monument Distractor',
  state: 'India & General',
  categories: [
    'Category:Botanical gardens in India',
    'Category:Modern architecture in India',
    'Category:Lakes of India',
  ],
  queries: [
    'Modern glass skyscraper building architecture',
    'Public park pathway trees garden',
    'Mountain valley landscape river scenery',
    'Museum exhibition hall interior gallery',
    'Urban city street traffic market',
    'Tea plantation hills Kerala Assam landscape',
  ],
  negativeKeywords: [
    'taj mahal',
    'agra fort',
    'fatehpur sikri',
    'red fort',
    'lal qila',
    'qutub',
    'qutb',
    'humayun',
    'ajanta',
    'ellora',
    'gateway of india',
    'sanchi',
    'khajuraho',
    'hampi',
    'gol gumbaz',
    'konark',
    'mahabalipuram',
    'mamallapuram',
    'amer fort',
    'amber fort',
    'chittorgarh',
    'charminar',
    'rani ki vav',
    'jantar mantar',
  ],
};

export const PROFILE_BY_SITE_ID = new Map<string, MonumentSearchProfile>([
  ...MONUMENT_SEARCH_PROFILES.map((p) => [p.siteId, p] as const),
  [UNKNOWN_DISTRACTOR_PROFILE.siteId, UNKNOWN_DISTRACTOR_PROFILE],
]);

export function getMonumentFolderName(siteId: string): string {
  return PROFILE_BY_SITE_ID.get(siteId)?.folderName ?? siteId.replace(/-/g, '_');
}
