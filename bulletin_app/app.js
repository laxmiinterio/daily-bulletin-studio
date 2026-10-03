// Daily Government Bulletin Studio v2.0 - Core Engine

// Initial Master State
let bulletin = {
  globalDate: "20th September, 2026",
  language: "en", // 'en', 'hi', 'bi'
  campaignTitle: "Swachhata Hi Seva 2026",
  logosConfig: {
    jalShakti: true,
    swachhata: true,
    mohua: true,
    customLogo: null
  },
  pages: [],
  segments: [],
  photoPool: [],
  customTemplates: []
};

// UI State
let activePageIndex = 0;
let isDrawerOpen = true;
let isReviewMode = false;
let currentCropper = null;
let currentCropTarget = null; // { pIdx, sIdx, imgIdx, isCover, isSpotlight, isCtu, pairIdx, type }
let currentSegmentUploadIdx = null;
let historyStack = [];
let redoStack = [];
let autoSaveTimer = null;
let hasUnsavedChanges = false;

// Bilingual Dictionary for Government Bulletins
const GOV_DICT = {
  "Cover Page": { hi: "मुखपृष्ठ" },
  "Overall Snapshot": { hi: "समग्र प्रगति अवलोकन" },
  "Top Stories of the Day": { hi: "आज की प्रमुख कहानियाँ" },
  "State & ULB Initiatives": { hi: "राज्य एवं शहरी निकाय पहल" },
  "Citizen Participation": { hi: "नागरिक सहभागिता" },
  "Key Highlights from Central Ministries": { hi: "केंद्रीय मंत्रालयों की प्रमुख पहल" },
  "CTU Transformations in Focus": { hi: "स्वच्छता लक्षित इकाइयाँ (CTU) रूपांतरण" },
  "Swachhata in Spotlight": { hi: "स्वच्छता सुर्खियाँ (सोशल मीडिया)" },
  "Back Cover": { hi: "हमसे जुड़ें" },
  "VISIT US": { hi: "हमसे जुड़ें" }
};

// Automatic Bidirectional Reverse Dictionary
const GOV_DICT_REVERSE = {};
Object.entries(GOV_DICT).forEach(([enKey, val]) => {
  if (val.hi) GOV_DICT_REVERSE[val.hi] = enKey;
});

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==================== TOAST & CONFIRM NOTIFICATIONS ====================
function showToast(message, type = "info", durationMs = 3500) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(12px)";
    toast.style.transition = "all 0.25s ease";
    setTimeout(() => toast.remove(), 250);
  }, durationMs);
}

function showInlineConfirm(message, onYes) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast warn";
  toast.style.display = "flex";
  toast.style.gap = "10px";
  toast.style.alignItems = "center";
  toast.innerHTML = `
    <span style="flex:1;">${message}</span>
    <button class="confirm-yes-btn" style="background:#ef4444;color:white;border:none;padding:5px 12px;border-radius:4px;font-weight:700;cursor:pointer;">Yes</button>
    <button class="confirm-no-btn" style="background:#64748b;color:white;border:none;padding:5px 12px;border-radius:4px;font-weight:700;cursor:pointer;">Cancel</button>
  `;
  toast.querySelector(".confirm-yes-btn").onclick = () => { toast.remove(); onYes(); };
  toast.querySelector(".confirm-no-btn").onclick = () => { toast.remove(); };
  container.appendChild(toast);
}

// ==================== INDEXEDDB IMAGE STORE & IN-MEMORY CACHE ====================
const imageCache = new Map();
const IMG_DB_NAME = "GovBulletinImageDB_v2";
const IMG_DB_VERSION = 1;
const IMG_STORE_NAME = "images";

function openImageDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IMG_DB_NAME, IMG_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IMG_STORE_NAME)) {
        db.createObjectStore(IMG_STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function initIndexedDB() {
  try {
    const db = await openImageDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IMG_STORE_NAME, "readonly");
      const store = tx.objectStore(IMG_STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          imageCache.set(cursor.value.id, cursor.value.data);
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
  } catch (err) {
    console.warn("IndexedDB init warning:", err);
  }
}

async function storeImage(dataUrl) {
  if (!dataUrl) return "assets/sample1.jpg";
  if (dataUrl.startsWith("assets/")) return dataUrl;
  const id = "img_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  imageCache.set(id, dataUrl);
  try {
    const db = await openImageDB();
    const tx = db.transaction(IMG_STORE_NAME, "readwrite");
    tx.objectStore(IMG_STORE_NAME).put({ id, data: dataUrl, created: Date.now() });
  } catch (err) {
    console.warn("IndexedDB save failed:", err);
  }
  return id;
}

function getImageSync(id) {
  if (!id) return "assets/sample1.jpg";
  if (id.startsWith("assets/") || id.startsWith("data:")) return id;
  return imageCache.get(id) || "assets/sample1.jpg";
}

// ==================== IMAGE COMPRESSOR PIPELINE ====================
function compressImage(fileOrDataUrl, maxW = 1200, maxH = 1200, quality = 0.80) {
  return new Promise((resolve) => {
    const processImg = (src) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };

    if (typeof fileOrDataUrl === "string") {
      processImg(fileOrDataUrl);
    } else if (fileOrDataUrl instanceof Blob || fileOrDataUrl instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => processImg(e.target.result);
      reader.onerror = () => resolve("assets/sample1.jpg");
      reader.readAsDataURL(fileOrDataUrl);
    } else {
      resolve("assets/sample1.jpg");
    }
  });
}

// Default Swachhata 17-Page Sequence Definition
const STANDARD_17_PAGE_PACK = [
  {
    id: "p-1", type: "cover", theme: "theme-teal", sectionTitle: "Cover Page",
    coverTitle: "Swachhata\\nHi Seva", coverYear: "2026", coverBadge: "Bulletin", coverDate: "20th September, 2026",
    images: ["assets/sample1.jpg", "assets/sample3.jpg", "assets/sample4.jpg"], isLocked: true
  },
  {
    id: "p-2", type: "snapshot", theme: "theme-green", sectionTitle: "Overall Snapshot",
    heroHeadline: "Overall Citizens Participation: 85,98,584", heroSub: "Households Participated: 27,97,819",
    stats: [
      { label: "Transformation of Cleanliness Target Units (CTUs)", val1: "9,83,108 Total CTUs", val2: "1,59,292 CTUs Cleaned", val3: "59,77,214 Participants", val4: "23,201 Public Spots", val5: "9,39,006 Citizens Engaged" },
      { label: "Swachh Paathshala - Yuva for Swachhata", val1: "69,928 Awareness Drives", val2: "31,769 RRR Drives", val3: "10,17,363 Students", val4: "16,116 Gyan Yatra", val5: "3,15,670 Youth Engaged" },
      { label: "SafaiMitra Suraksha Evam Samman Shivirs", val1: "1,382 Shivirs Held", val2: "8,006 Workers", val3: "2,013 Health Camps", val4: "5,393 PPE Kits", val5: "14,922 Welfare Enrolled" },
      { label: "Advocacy & Public Mobilisation", val1: "1,05,599 Segregations", val2: "592 RRR Centers", val3: "16,769 Green Events", val4: "23,556 Sports Drives", val5: "12,830 Home Composting" },
      { label: "Swachh Market & Clean Water Bodies", val1: "1,04,247 Bazaars", val2: "14,114 Mohallas", val3: "14,167 Offices", val4: "49,762 Water Bodies", val5: "Active Drives" }
    ]
  },
  {
    id: "p-3", type: "hero-1-story", theme: "theme-orange", sectionTitle: "Top Stories of the Day",
    stories: [{
      headline: "Andhra CM Leads Ocean Cleanup at Visakhapatnam",
      blurb: "At Visakhapatnam's RK Beach, Chief Minister Sh. Chandrababu Naidu reviewed the sea cleanliness drive, and virtually inaugurated the Ocean Plastic Recovery Center pilot site at Pedajalaripeta. He interacted with sanitation workers, fishermen, and scuba divers engaged in marine waste collection, observed digital weighing of ocean debris, and distributed incentives to fishermen who now earn additional income by removing plastic waste alongside fishing.",
      images: ["assets/sample3.jpg", "assets/sample1.jpg", "assets/sample4.jpg"]
    }]
  },
  {
    id: "p-4", type: "split-2-story", theme: "theme-orange", sectionTitle: "Top Stories of the Day",
    stories: [
      {
        headline: "Sudarsan Pattnaik Leads Beach Clean-Up in Puri",
        blurb: "Renowned sand artist Sudarsan Pattnaik joined hands with volunteers to clean Puri Beach, reinforcing the message of collective responsibility towards coastal cleanliness. His initiative not only removed waste from the shoreline but also inspired citizens to actively participate in preserving the beauty and health of the iconic beach.",
        images: ["assets/sample4.jpg"]
      },
      {
        headline: "Parks Get a Clean Makeover in Jodhpur; 98 tons waste cleared",
        blurb: "Jodhpur Municipal Corporation, Rajasthan launched a three-day special cleanliness drive focused on the cleaning and beautification of city parks. On Day 1, 50 officers inspected 100 parks, with residents adopting 22 parks through signed MoUs. A total of 98 tonnes of waste was cleared, while Waste-to-Wonder installations were set up in two parks.",
        images: ["assets/sample6.jpg"]
      }
    ]
  },
  {
    id: "p-5", type: "ctu-transformation", theme: "theme-coral", sectionTitle: "CTU Transformations in Focus",
    pairCount: 2,
    ctuPairs: [
      {
        title: "Somnath Community Hall Vicinity Transformation (Ward 17)",
        location: "Rewa, Madhya Pradesh",
        beforeImg: "assets/sample10.jpg", afterImg: "assets/sample6.jpg",
        beforeDate: "15th Sept", afterDate: "20th Sept",
        desc: "A persistent open garbage dumping blackspot was completely cleared, leveled, and converted into a green recreation corner."
      },
      {
        title: "Koparkhairane Waste Transport Yard Cleanup",
        location: "Navi Mumbai, Maharashtra",
        beforeImg: "assets/sample4.jpg", afterImg: "assets/sample3.jpg",
        beforeDate: "16th Sept", afterDate: "20th Sept",
        desc: "Intensive deep cleaning and sanitization carried out jointly by municipal workers and transport fleet teams."
      }
    ]
  },
  {
    id: "p-6", type: "standard-3-story", theme: "theme-blue", sectionTitle: "State & ULB Initiatives",
    stories: [
      {
        headline: "CTU Cleaning & Beautification Drive in Tirupati",
        blurb: "Tirupati carried out a dedicated CTU Cleaning and Beautification Drive at NGOs Colony, marked by the active participation of officials, NCC students, sanitation workers, and citizens.",
        images: ["assets/sample6.jpg"]
      },
      {
        headline: "Students Gain First-Hand Insight into Waste Management at MRF",
        blurb: "Sri Vijaya Puram Municipal Council (A&N Islands) organised an exposure visit for school and college students to the Material Recovery Facility (MRF) at Brookshabad. SVPMC officials briefed the students on MRF operations, waste handling, segregation, and scientific waste processing.",
        images: ["assets/sample10.jpg"]
      },
      {
        headline: "Rewa: Street Play Spreads Awareness on Plastic Ban",
        blurb: "The cleanliness team in Ward No. 18 near Sai Mandir in Madhya Pradesh's Rewa organised a street play to raise awareness among citizens about the harmful effects of single-use plastic. Residents and shopkeepers were also instructed not to use banned plastic items.",
        images: ["assets/sample4.jpg"]
      }
    ]
  },
  {
    id: "p-7", type: "standard-3-story", theme: "theme-blue", sectionTitle: "State & ULB Initiatives",
    stories: [
      {
        headline: "Patna Municipal Express Teams Mobilize Door-to-Door Collection",
        blurb: "Patna Municipal Corporation deployed special Safai Express electric tippers in underserved wards, registering over 14,000 households for 100% daily source segregation.",
        images: ["assets/sample1.jpg"]
      },
      {
        headline: "Panaji RRR Center Drive Promotes Sharing & Circular Living",
        blurb: "The Corporation of the City of Panaji, Goa, mobilized 42 residential societies for clothes, books, and toy donations, diverting 4.8 tonnes of usable goods from landfills.",
        images: ["assets/sample6.jpg"]
      },
      {
        headline: "Ranchi Lakefront Cleanliness Drive Removes 12 Tons Hyacinth",
        blurb: "Civic workers and citizen volunteers cleared water hyacinth and plastic debris from Ranchi's main lake, installing floating aeration fountains for natural water purification.",
        images: ["assets/sample3.jpg"]
      }
    ]
  },
  {
    id: "p-8", type: "standard-3-story", theme: "theme-coral", sectionTitle: "Citizen Participation",
    stories: [
      {
        headline: "Youth Cyclothon Champions Zero-Waste Across Chandigarh",
        blurb: "Over 800 young cyclists pedaled across 15 sectors of Chandigarh, carrying flags and placards promoting home composting and discouraging disposable plastic beverage cups.",
        images: ["assets/sample4.jpg"]
      },
      {
        headline: "Kolkata Resident Welfare Associations Pioneer Wet Waste Composting",
        blurb: "Six prominent housing complexes in New Town, Kolkata inaugurated community drum composters, processing 1.5 tonnes of daily kitchen waste into organic plant fertilizer.",
        images: ["assets/sample6.jpg"]
      },
      {
        headline: "Senior Citizens Lead Morning Shramdaan at Bengaluru Public Park",
        blurb: "A group of 120 morning walkers and retired veterans cleaned park jogging tracks and created ornamental flowerbeds using recycled terracotta pots.",
        images: ["assets/sample1.jpg"]
      }
    ]
  },
  {
    id: "p-9", type: "standard-3-story", theme: "theme-coral", sectionTitle: "Citizen Participation",
    stories: [
      {
        headline: "School Eco-Clubs Transform Broken Walls with Swachhata Murals",
        blurb: "Fine arts students and schoolchildren painted over 500 meters of public boundary walls with vibrant folk art celebrating clean rivers and hygienic neighborhoods.",
        images: ["assets/sample4.jpg"]
      },
      {
        headline: "Women Self-Help Groups Launch Cloth Bag Stalls in Local Markets",
        blurb: "Under the livelihood mission, women entrepreneurs distributed 25,000 hand-stitched cotton carry bags across vegetable mandis, directly replacing single-use polythene.",
        images: ["assets/sample3.jpg"]
      },
      {
        headline: "Mountain Plogging Expedition Clears Himalayan Trekking Trails",
        blurb: "Volunteer mountaineers collected 18 sacks of discarded bottles and snack wrappers along popular mountain hiking trails, restoring the pristine Himalayan landscape.",
        images: ["assets/sample1.jpg"]
      }
    ]
  },
  {
    id: "p-10", type: "standard-3-story", theme: "theme-purple", sectionTitle: "Key Highlights from Central Ministries",
    stories: [
      {
        headline: "Ministry of Defence Executes Cleanliness Drive Across Cantonments",
        blurb: "Armed forces units and defence civilians executed intensive cleanliness drives across military stations, airbases, and naval dockyards, clearing 45 tonnes of scrap material.",
        images: ["assets/sample3.jpg"]
      },
      {
        headline: "Indian Railways Sanitizes 2,400 Railway Stations and Tracks",
        blurb: "Railway divisions mobilized mechanized high-pressure jet cleaners across platforms, waiting halls, and track approaches, earning widespread commuter appreciation.",
        images: ["assets/sample1.jpg"]
      },
      {
        headline: "Civil Aviation Terminals Achieve Single-Use Plastic Elimination",
        blurb: "Airports Authority of India verified 100% single-use plastic elimination across 84 civil airports, replacing plastic packaging with biodegradable alternatives.",
        images: ["assets/sample6.jpg"]
      }
    ]
  },
  {
    id: "p-11", type: "standard-3-story", theme: "theme-purple", sectionTitle: "Key Highlights from Central Ministries",
    stories: [
      {
        headline: "Health Ministry Conducts Deep Cleanliness Audits in District Hospitals",
        blurb: "Kayakalp hospital sanitation teams reviewed biomedical waste segregation, patient ward hygiene, and automated laundry services in 320 government healthcare centers.",
        images: ["assets/sample6.jpg"]
      },
      {
        headline: "Education Ministry Mobilizes 50,000 Campuses for Swachh Paathshala",
        blurb: "Colleges and universities conducted special cleanliness pledge ceremonies, campus clean-ups, and student debates on modern circular economy principles.",
        images: ["assets/sample4.jpg"]
      },
      {
        headline: "Petroleum Ministry Drives Used Cooking Oil to Biodiesel Conversion",
        blurb: "Oil marketing companies inaugurated 18 new collection points for used cooking oil from commercial eateries, diverting organic oils towards eco-friendly biofuel generation.",
        images: ["assets/sample1.jpg"]
      }
    ]
  },
  {
    id: "p-12", type: "standard-3-story", theme: "theme-purple", sectionTitle: "SafaiMitra Suraksha Evam Samman",
    stories: [
      {
        headline: "Nationwide Health Camps Screen Over 1.8 Lakh Sanitation Workers",
        blurb: "Doctors conducted comprehensive preventive health evaluations, respiratory checks, and vision tests, issuing free prescription eyeglasses and wellness kits.",
        images: ["assets/safaimitra_welfare.jpg"]
      },
      {
        headline: "PPE Kit Distribution Saturation Completed in 800 Urban Local Bodies",
        blurb: "Sanitation staff received certified personal protective equipment including heavy-duty puncture-resistant gloves, safety goggles, reinforced boots, and high-visibility jackets.",
        images: ["assets/safaimitra_welfare.jpg"]
      },
      {
        headline: "Ayushman Bharat Golden Card Coverage Reaches 100% Workforce",
        blurb: "Frontline sanitation workers and their dependents received instant Ayushman Bharat cards, guaranteeing free healthcare coverage up to Rs 5 lakh annually.",
        images: ["assets/sample3.jpg"]
      }
    ]
  },
  {
    id: "p-13", type: "spotlight-6", theme: "theme-green", sectionTitle: "Swachhata in Spotlight",
    images: [
      "assets/sample1.jpg", "assets/sample3.jpg", "assets/sample4.jpg",
      "assets/sample6.jpg", "assets/sample10.jpg", "assets/smart_city_fleet.jpg"
    ]
  },
  {
    id: "p-14", type: "spotlight-6", theme: "theme-green", sectionTitle: "Swachhata in Spotlight",
    images: [
      "assets/jal_shakti_river.jpg", "assets/green_earth_park.jpg", "assets/safaimitra_welfare.jpg",
      "assets/sample1.jpg", "assets/sample4.jpg", "assets/sample6.jpg"
    ]
  },
  {
    id: "p-15", type: "standard-3-story", theme: "theme-blue", sectionTitle: "Special Commendations & Best Practices",
    stories: [
      {
        headline: "Indore Model: 100% Bio-CNG Generated from City Food Waste",
        blurb: "Asia's largest municipal bio-CNG plant powers over 150 city buses daily solely from organic kitchen waste gathered across urban households.",
        images: ["assets/smart_city_fleet.jpg"]
      },
      {
        headline: "Surat Converts 100,000 Tonnes of C&D Debris into Paving Tiles",
        blurb: "Recycled construction rubble was processed into heavy-duty interlocking paver blocks, now utilized in public sidewalks and community sports grounds.",
        images: ["assets/green_earth_park.jpg"]
      },
      {
        headline: "Ujjain Religious Waste Recycled into Organic Incense & Colors",
        blurb: "Floral offerings collected from temples were systematically processed by women cooperatives into fragrant natural dhoop sticks and organic Holi powders.",
        images: ["assets/sample4.jpg"]
      }
    ]
  },
  {
    id: "p-16", type: "snapshot", theme: "theme-green", sectionTitle: "National League Table & Progress",
    heroHeadline: "National Swachhata League Score: 98.4%", heroSub: "Total States & UTs Actively Participating: 36 of 36",
    stats: [
      { label: "Top Performing Tier-1 Cities (>10 Lakh)", val1: "Indore (99.8%)", val2: "Surat (99.4%)", val3: "Navi Mumbai (98.9%)", val4: "Visakhapatnam", val5: "Bhopal (98.2%)" },
      { label: "Fastest Moving Coastal Districts", val1: "Puri (97.6%)", val2: "Kozhikode", val3: "Udupi (96.8%)", val4: "Diu", val5: "Thiruvananthapuram" },
      { label: "SafaiMitra Welfare Saturation Index", val1: "99.2% Health", val2: "98.7% PPE", val3: "96.4% Insurance", val4: "95.1% Training", val5: "100% Mechanized" }
    ]
  },
  {
    id: "p-17", type: "visit-us", theme: "theme-teal", sectionTitle: "Back Cover",
    visitText: "VISIT US", urbanTitle: "Swachh Bharat Mission – Urban", grameenTitle: "Swachh Bharat Mission (Grameen)", isLocked: true
  }
];

// 2. Executive 5-Page Digest Pack
const EXECUTIVE_5_PACK = [
  {
    id: "page-1", type: "cover", theme: "theme-navy", sectionTitle: "Cover Page",
    coverTitle: "Daily Executive\\nBriefing", coverYear: "2026", coverBadge: "High-Level Review", coverDate: "20th September, 2026",
    images: ["assets/smart_city_fleet.jpg", "assets/sample3.jpg", "assets/sample1.jpg"], isLocked: true
  },
  {
    id: "page-2", type: "snapshot", theme: "theme-navy", sectionTitle: "Overall Snapshot",
    heroHeadline: "National Daily Execution: 1,42,890 Wards Monitored", heroSub: "Total Shramdaan Hours Logged: 48,20,110 hrs",
    stats: [
      { label: "Cleanliness Target Units (CTUs) Cleared", val1: "9,83,108 Identified", val2: "1,59,292 Cleared", val3: "59,77,214 Citizens", val4: "23,201 Spots", val5: "94.8% Verified" },
      { label: "SafaiMitra Suraksha & Welfare Camps", val1: "1,382 Camps", val2: "8,006 Screened", val3: "2,013 Health Camps", val4: "5,393 PPE Kits", val5: "14,922 Enrolled" },
      { label: "Public Mobilisation & RRR Saturation", val1: "1,05,599 Drives", val2: "592 RRR Centers", val3: "16,769 Green Events", val4: "23,556 Drives", val5: "12,830 Units" }
    ]
  },
  {
    id: "page-3", type: "hero-1-story", theme: "theme-navy", sectionTitle: "Top Stories of the Day",
    stories: [{
      headline: "Hon'ble Minister Reviews Pan-India Sanitation Saturation Drive",
      blurb: "A high-level inter-ministerial review assessed ground-level progress under the Swachhata Hi Seva campaign across state capitals and major municipal corporations. Emphasizing digital geo-tagged verification of eliminated blackspots, senior officials reviewed mechanized sanitation equipment deployment and instructed municipal commissioners to prioritize SafaiMitra healthcare saturation.",
      images: ["assets/sample3.jpg", "assets/smart_city_fleet.jpg", "assets/sample1.jpg"]
    }]
  },
  {
    id: "page-4", type: "split-2-story", theme: "theme-navy", sectionTitle: "State & ULB Initiatives",
    stories: [
      { headline: "State Administrations Accelerate Zero-Landfill Transformation", blurb: "Chief Secretaries issued unified directives mandating bio-remediation of legacy dumpsites and zero-waste public events across all municipal districts.", images: ["assets/sample6.jpg"] },
      { headline: "District Collectors Mobilize Gram Panchayats for Door-to-Door Saturation", blurb: "Rural development departments achieved 100% daily segregated waste pickup coverage across 42,000 model villages under ODF Plus protocols.", images: ["assets/sample4.jpg"] }
    ]
  },
  {
    id: "page-5", type: "visit-us", theme: "theme-navy", sectionTitle: "Back Cover", visitText: "VISIT US", isLocked: true
  }
];

// 3. CTU Transformations Special Pack
const CTU_SPECIAL_PACK = [
  {
    id: "page-1", type: "cover", theme: "theme-crimson", sectionTitle: "Cover Page",
    coverTitle: "Mission CTU\\nTransformation", coverYear: "2026", coverBadge: "Blackspot Elimination", coverDate: "20th September, 2026",
    images: ["assets/sample10.jpg", "assets/sample6.jpg", "assets/green_earth_park.jpg"], isLocked: true
  },
  {
    id: "page-2", type: "snapshot", theme: "theme-crimson", sectionTitle: "Overall Snapshot",
    heroHeadline: "Total CTUs Identified: 9,83,108", heroSub: "CTUs Successfully Transformed: 1,59,292",
    stats: [
      { label: "Legacy Waste Dumpsites Cleared", val1: "12,410 Sites", val2: "84,000 Tonnes", val3: "4,200 Machinery Units", val4: "1,200 Ward Teams", val5: "High Impact" },
      { label: "Public Transit Blackspots Restored", val1: "45,210 Cleaned", val2: "32,100 Beautified", val3: "18,500 Painted Walls", val4: "9,800 Plantations", val5: "Sustainable" },
      { label: "Citizen Cleanliness Pledges at CTUs", val1: "62,400 Pledges", val2: "4,800 MoUs Signed", val3: "12,000 Bins Installed", val4: "98% No Re-dump", val5: "Strict Vigil" }
    ]
  },
  {
    id: "page-3", type: "ctu-transformation", theme: "theme-crimson", sectionTitle: "CTU Transformations in Focus", pairCount: 2,
    ctuPairs: [
      {
        title: "Somnath Community Hall Vicinity Transformation (Ward 17)",
        location: "Rewa, Madhya Pradesh",
        beforeImg: "assets/sample10.jpg", afterImg: "assets/sample6.jpg",
        beforeDate: "15th Sept", afterDate: "20th Sept",
        desc: "A persistent open garbage dumping blackspot was completely cleared, leveled, and converted into a green recreation corner."
      },
      {
        title: "Koparkhairane Waste Transport Yard Cleanup",
        location: "Navi Mumbai, Maharashtra",
        beforeImg: "assets/sample4.jpg", afterImg: "assets/sample3.jpg",
        beforeDate: "16th Sept", afterDate: "20th Sept",
        desc: "Intensive deep cleaning and sanitization carried out jointly by municipal workers and transport fleet teams."
      }
    ]
  },
  {
    id: "page-4", type: "ctu-transformation", theme: "theme-crimson", sectionTitle: "CTU Transformations in Focus", pairCount: 2,
    ctuPairs: [
      {
        title: "Railway Approach Road Blackspot Remediated into Garden",
        location: "Tirupati, Andhra Pradesh",
        beforeImg: "assets/sample10.jpg", afterImg: "assets/green_earth_park.jpg",
        beforeDate: "14th Sept", afterDate: "20th Sept",
        desc: "Over 40 tonnes of construction and municipal rubble was removed and replaced by walking pavers and native flowering shrubs."
      },
      {
        title: "Canal Embankment Garbage Vulnerability Point Cleared",
        location: "Lucknow, Uttar Pradesh",
        beforeImg: "assets/sample4.jpg", afterImg: "assets/sample6.jpg",
        beforeDate: "16th Sept", afterDate: "20th Sept",
        desc: "Waste dumping zone cleared with backhoe loaders; local citizen surveillance committee established to ensure cleanliness."
      }
    ]
  },
  {
    id: "page-5", type: "visit-us", theme: "theme-crimson", sectionTitle: "Back Cover", visitText: "VISIT US", isLocked: true
  }
];

// 4. Green Earth & Circular Economy Pack
const GREEN_EARTH_PACK = [
  {
    id: "page-1", type: "cover", theme: "theme-emerald", sectionTitle: "Cover Page",
    coverTitle: "Paryavaran &\\nSwachhata", coverYear: "2026", coverBadge: "Circular Economy", coverDate: "20th September, 2026",
    images: ["assets/green_earth_park.jpg", "assets/sample6.jpg", "assets/sample4.jpg"], isLocked: true
  },
  {
    id: "page-2", type: "snapshot", theme: "theme-emerald", sectionTitle: "Overall Snapshot",
    heroHeadline: "Total Green Shramdaan Volunteers: 28,45,190", heroSub: "Trees Planted ('Ek Ped Maa Ke Naam'): 14,20,500 Saplings",
    stats: [
      { label: "RRR Centers (Reduce, Reuse, Recycle)", val1: "12,410 Centers", val2: "1,84,000 Tonnes Goods", val3: "92,000 Beneficiaries", val4: "4,200 Wards", val5: "Zero Waste" },
      { label: "Decentralized Wet Waste Composting", val1: "48,200 Units", val2: "32,400 Tonnes Compost", val3: "18,000 Farmers", val4: "City Compost Brand", val5: "Organic" },
      { label: "Waste-to-Art Public Installations", val1: "540 Park Sculptures", val2: "120 Scrap Gardens", val3: "450 Tonnes Metal", val4: "180 Tyre Sculptures", val5: "Eco-Tourism" }
    ]
  },
  {
    id: "page-3", type: "hero-1-story", theme: "theme-emerald", sectionTitle: "Top Stories of the Day",
    stories: [{
      headline: "Vrindavan Waste-to-Wealth Eco-Park Restores 12-Acre Municipal Dumpsite",
      blurb: "A former 12-acre municipal open dump has been miraculously transformed into the Vrindavan Waste-to-Wealth Public Eco-Park. Featuring life-sized artistic sculptures crafted entirely from scrap tyres, decommissioned street poles, and discarded scrap metal, the facility also includes a 5 TPD on-site organic composting reactor powering botanical nurseries and public gardens.",
      images: ["assets/green_earth_park.jpg", "assets/sample6.jpg", "assets/sample4.jpg"]
    }]
  },
  {
    id: "page-4", type: "split-2-story", theme: "theme-emerald", sectionTitle: "State & ULB Initiatives",
    stories: [
      { headline: "Decentralized Biomethanation Plants Power Street Lighting in 14 Wards", blurb: "City administrations installed automated biomethanation digesters processing food waste from wholesale markets into green biogas electricity.", images: ["assets/sample6.jpg"] },
      { headline: "Zero-Plastic Bazaars: 50,000 Cloth Bags Distributed by Women SHGs", blurb: "Local women cooperatives set up eco-stalls replacing thin polythene carry bags with washable cotton totes across vegetable and grain markets.", images: ["assets/sample4.jpg"] }
    ]
  },
  {
    id: "page-5", type: "standard-3-story", theme: "theme-emerald", sectionTitle: "Citizen Participation",
    stories: [
      { headline: "School Eco-Clubs Champion Seedball Preparation Across 120 Campuses", blurb: "Students rolled 1.2 lakh native tree seedballs to be dispersed along dry hillsides and highway medians during seasonal monsoon showers.", images: ["assets/sample4.jpg"] },
      { headline: "Construction & Demolition Waste Processed into Eco-Bricks for Sidewalks", blurb: "Municipal recycling mills pulverized 8,000 tonnes of concrete debris into certified paving bricks for city footpaths.", images: ["assets/green_earth_park.jpg"] },
      { headline: "Green Sunday Community Drive Cleans and Rejuvenates Urban Orchards", blurb: "Over 4,000 citizen volunteers cleared wild weeds, mulched trees with compost, and established drip irrigation rings in civic botanical gardens.", images: ["assets/sample6.jpg"] }
    ]
  },
  {
    id: "page-6", type: "visit-us", theme: "theme-emerald", sectionTitle: "Back Cover", visitText: "VISIT US", isLocked: true
  }
];

// 5. Smart City & Municipal Ops Pack
const SMART_CITY_PACK = [
  {
    id: "page-1", type: "cover", theme: "theme-indigo", sectionTitle: "Cover Page",
    coverTitle: "Smart City &\\nMunicipal Ops", coverYear: "2026", coverBadge: "Urban Governance", coverDate: "20th September, 2026",
    images: ["assets/smart_city_fleet.jpg", "assets/sample1.jpg", "assets/sample6.jpg"], isLocked: true
  },
  {
    id: "page-2", type: "snapshot", theme: "theme-indigo", sectionTitle: "Overall Snapshot",
    heroHeadline: "Urban Waste Segregation at Source: 92.4%", heroSub: "Active Mechanized Sweeping Fleet: 1,840 Units",
    stats: [
      { label: "Mechanized Night Sweeping Coverage", val1: "4,820 km Arterials", val2: "100% Dust Free", val3: "98.2% Vehicle Uptime", val4: "GPS Tracked", val5: "PM10 Reduced" },
      { label: "Automated Material Recovery Facilities (MRF)", val1: "420 Mega MRFs", val2: "18,400 Tonnes/Day", val3: "94% Dry Sorted", val4: "Baling Plants", val5: "Zero Landfill" },
      { label: "Integrated Command & Control Center (ICCC)", val1: "24,000 IoT Sensors", val2: "99.4% Bin Compliance", val3: "3,200 Tiper Fleets", val4: "RFID Tracked", val5: "Real-time" }
    ]
  },
  {
    id: "page-3", type: "hero-1-story", theme: "theme-indigo", sectionTitle: "Top Stories of the Day",
    stories: [{
      headline: "Naya Raipur Municipal Corporation Launches 100% Electric Sweeping Fleet",
      blurb: "To achieve zero-emission municipal maintenance, the city administration inducted 45 high-capacity all-electric street sweepers and GPS-linked secondary collection tippers. The mechanized fleet operates on a 24x7 scheduled grid, drastically cutting airborne particulate pollution (PM10) along arterial avenues while improving operator ergonomic safety.",
      images: ["assets/smart_city_fleet.jpg", "assets/sample1.jpg", "assets/sample3.jpg"]
    }]
  },
  {
    id: "page-4", type: "split-2-story", theme: "theme-indigo", sectionTitle: "State & ULB Initiatives",
    stories: [
      { headline: "Command & Control Center (ICCC) Integrates Real-time Bin Fill Sensors", blurb: "Ultrasonic sensors fitted inside communal bins trigger automated dispatch alerts to nearby compactor trucks once levels hit 80% volume.", images: ["assets/smart_city_fleet.jpg"] },
      { headline: "Mechanized Night Cleaning Drive Sanitizes High-Density Commercial Corridors", blurb: "Water recycling vacuum sweepers and scrubbers sanitized 14 central bazaar corridors during zero-traffic night hours.", images: ["assets/sample6.jpg"] }
    ]
  },
  {
    id: "page-5", type: "visit-us", theme: "theme-indigo", sectionTitle: "Back Cover", visitText: "VISIT US", isLocked: true
  }
];

// 6. Jan Andolan: Citizen Mobilization & Youth Action Pack
const JAN_ANDOLAN_PACK = [
  {
    id: "page-1", type: "cover", theme: "theme-saffron", sectionTitle: "Cover Page",
    coverTitle: "Jan Andolan\\nSwachhata", coverYear: "2026", coverBadge: "Citizen Champions", coverDate: "20th September, 2026",
    images: ["assets/sample4.jpg", "assets/sample1.jpg", "assets/sample3.jpg"], isLocked: true
  },
  {
    id: "page-2", type: "snapshot", theme: "theme-saffron", sectionTitle: "Overall Snapshot",
    heroHeadline: "Total Youth & Citizen Volunteers: 1,12,40,900", heroSub: "Swachhata Pledges Taken: 78,50,000 Citizens",
    stats: [
      { label: "Community Shramdaan Drives Executed", val1: "1,05,599 Drives", val2: "4.8 Crore Hours", val3: "24,000 Wards", val4: "58,000 Villages", val5: "Mass Action" },
      { label: "Swachhata Cyclothons & Marathons", val1: "8,420 Cyclothons", val2: "14,20,000 Runners", val3: "98,000 km Covered", val4: "Zero Waste Events", val5: "High Spirit" },
      { label: "School & College Student Campaigns", val1: "69,928 Paathshalas", val2: "1.2 Crore Students", val3: "45,000 Murals", val4: "18,000 Plays", val5: "Youth Energy" }
    ]
  },
  {
    id: "page-3", type: "hero-1-story", theme: "theme-saffron", sectionTitle: "Top Stories of the Day",
    stories: [{
      headline: "Mass Shramdaan Mobilizes 65,000 Volunteers for Historic Heritage Cleanliness Drive",
      blurb: "From school students and NCC cadets to senior citizen forums and residential welfare associations, citizens assembled at dawn to execute comprehensive shramdaan across public squares, heritage monument approaches, and central marketplaces. The massive community collective demonstrated that cleanliness is fundamentally a shared cultural value.",
      images: ["assets/sample4.jpg", "assets/sample1.jpg", "assets/sample6.jpg"]
    }]
  },
  {
    id: "page-4", type: "split-2-story", theme: "theme-saffron", sectionTitle: "Citizen Participation",
    stories: [
      { headline: "Yuva Cyclothon Covers 35 Kilometers Spreading Segregation Awareness", blurb: "Over 2,500 college athletes cycled through residential sectors waving informative placards on 2-bin segregation.", images: ["assets/sample4.jpg"] },
      { headline: "College Fine Arts Students Transform 2,000 Meters of Broken Boundary Walls with Murals", blurb: "Vibrant traditional Warli and Madhubani murals now adorn former garbage blackspots, deterring future public dumping.", images: ["assets/sample6.jpg"] }
    ]
  },
  {
    id: "page-5", type: "standard-3-story", theme: "theme-saffron", sectionTitle: "Citizen Participation",
    stories: [
      { headline: "Market Welfare Associations Pledge 100% Ban on Single-Use Plastic Bags", blurb: "Commercial trader bodies unanimously agreed to enforce cloth-bag-only policies, fining violators internally.", images: ["assets/sample1.jpg"] },
      { headline: "Self-Help Groups Lead Home Composting Masterclasses in 40 Residential Societies", blurb: "Urban housewives were trained in aerated terra-cotta bio-composters, turning daily vegetable trimmings into rich black soil.", images: ["assets/sample4.jpg"] },
      { headline: "Ploggers Jog & Clean: 18 Tonnes of Plastic Waste Recovered Along Foothill Trails", blurb: "Fitness enthusiasts combined cardiovascular jogging with litter cleanup, collecting thousands of discarded snack wrappers.", images: ["assets/green_earth_park.jpg"] }
    ]
  },
  {
    id: "page-6", type: "visit-us", theme: "theme-saffron", sectionTitle: "Back Cover", visitText: "VISIT US", isLocked: true
  }
];

// 7. SafaiMitra Suraksha & Welfare Special Pack
const SAFAIMITRA_PACK = [
  {
    id: "page-1", type: "cover", theme: "theme-purple", sectionTitle: "Cover Page",
    coverTitle: "SafaiMitra Suraksha\\nEvam Samman", coverYear: "2026", coverBadge: "Worker Dignity", coverDate: "20th September, 2026",
    images: ["assets/safaimitra_welfare.jpg", "assets/sample3.jpg", "assets/sample1.jpg"], isLocked: true
  },
  {
    id: "page-2", type: "snapshot", theme: "theme-purple", sectionTitle: "Overall Snapshot",
    heroHeadline: "SafaiMitras Screened in Health Camps: 1,84,320", heroSub: "Personal Protective Equipment (PPE) Distributed: 2,15,000 Kits",
    stats: [
      { label: "Preventive Healthcare & Eye Screenings", val1: "2,410 Camps Held", val2: "1,84,320 Workers", val3: "42,000 Glasses Given", val4: "Free Meds", val5: "Full Saturation" },
      { label: "Ayushman Bharat Golden Card Coverage", val1: "99.8% Workers Enrolled", val2: "Rs 5 Lakh Cover", val3: "Zero Out-of-Pocket", val4: "Full Family", val5: "Dignity" },
      { label: "100% Mechanized Cleaning Transition", val1: "1,200 Suction Trucks", val2: "340 Robotic Units", val3: "Zero Manual Entry", val4: "Certified Ops", val5: "Life Safety" }
    ]
  },
  {
    id: "page-3", type: "hero-1-story", theme: "theme-purple", sectionTitle: "Top Stories of the Day",
    stories: [{
      headline: "SafaiMitra Samman Samaroh Honors 1,200 Frontline Sanitation Champions",
      blurb: "In a dedicated civic ceremony, municipal leadership awarded certificates of distinction, comprehensive healthcare kits, and full Ayushman Bharat golden cards to frontline sanitation workers. The administration highlighted the transition to 100% mechanized sewer entry, strictly enforcing zero hazardous manual cleaning protocols across all wards.",
      images: ["assets/safaimitra_welfare.jpg", "assets/sample3.jpg", "assets/sample1.jpg"]
    }]
  },
  {
    id: "page-4", type: "split-2-story", theme: "theme-purple", sectionTitle: "SafaiMitra Welfare & Dignity",
    stories: [
      { headline: "Robotic Manhole Scavenging Units Deployed Across Core Sewer Network", blurb: "Compact robotic entry machines with high-definition optical sensors and mechanized grabbers now service deep underground junctions.", images: ["assets/safaimitra_welfare.jpg"] },
      { headline: "Free Preventive Health Screenings Saturation Reaches 100% Municipal Workforce", blurb: "Specialized occupational pulmonologists and dermatologists conducted extensive health profiles for all municipal cleaning personnel.", images: ["assets/smart_city_fleet.jpg"] }
    ]
  },
  {
    id: "page-5", type: "visit-us", theme: "theme-purple", sectionTitle: "Back Cover", visitText: "VISIT US", isLocked: true
  }
];

// 8. Jal Shakti & Coastal Cleanliness Pack
const JAL_SHAKTI_PACK = [
  {
    id: "page-1", type: "cover", theme: "theme-cyan", sectionTitle: "Cover Page",
    coverTitle: "Jal Shakti &\\nCoastal Swachhata", coverYear: "2026", coverBadge: "Clean Rivers & Seas", coverDate: "20th September, 2026",
    images: ["assets/jal_shakti_river.jpg", "assets/sample3.jpg", "assets/sample1.jpg"], isLocked: true
  },
  {
    id: "page-2", type: "snapshot", theme: "theme-cyan", sectionTitle: "Overall Snapshot",
    heroHeadline: "Kilometers of Coastline Cleaned: 4,820 km", heroSub: "Water Bodies & Ghats Rejuvenated: 16,340 Sites",
    stats: [
      { label: "Coastal Marine Plastic Debris Diverted", val1: "8,420 Tonnes", val2: "18 Harbors", val3: "4,200 Scuba Dives", val4: "Fishermen Incentivized", val5: "Ocean Recovery" },
      { label: "Riverfront Ghats Sanitized (Namami Gange)", val1: "1,240 Ghats", val2: "45 Rivers", val3: "High-Pressure Jets", val4: "Trash Skimmers", val5: "Sparkling" },
      { label: "Urban Wetlands & Lake Conservation", val1: "2,840 Water Bodies", val2: "De-silted", val3: "Aeration Fountains", val4: "Bio-fencing", val5: "Ecosystem Revived" }
    ]
  },
  {
    id: "page-3", type: "hero-1-story", theme: "theme-cyan", sectionTitle: "Top Stories of the Day",
    stories: [{
      headline: "Sunrise Ghat Sanitization & River Cleanup Drives Rejuvenate Sacred Waters",
      blurb: "At dawn along historic riverfront stone steps, municipal task forces and volunteer pilgrims united to sweep, sanitize, and de-silt riverbanks. Utilizing floating trash skimmers and biodegradable collection baskets, hundreds of kilograms of floral and plastic waste were collected and diverted directly to localized bio-composting pits.",
      images: ["assets/jal_shakti_river.jpg", "assets/sample3.jpg", "assets/sample1.jpg"]
    }]
  },
  {
    id: "page-4", type: "split-2-story", theme: "theme-cyan", sectionTitle: "Jal Shakti Initiatives",
    stories: [
      { headline: "Scuba Divers & Fishermen Divert 15 Tonnes of Ghost Fishing Nets at Coastal Harbor", blurb: "Deep-sea divers freed coral reefs and underwater marine life from abandoned commercial nylon netting off the eastern coastline.", images: ["assets/sample3.jpg"] },
      { headline: "Wetland Bio-remediation Project Restores Natural Water Quality in Urban Lake Basin", blurb: "Engineered reed beds and floating wetland islands effectively filtered urban stormwater runoff before entering the reservoir.", images: ["assets/jal_shakti_river.jpg"] }
    ]
  },
  {
    id: "page-5", type: "visit-us", theme: "theme-cyan", sectionTitle: "Back Cover", visitText: "VISIT US", isLocked: true
  }
];

// 9. Swachhata in Lens (Photojournalism Spotlight Pack)
const PHOTOJOURNALISM_PACK = [
  {
    id: "page-1", type: "cover", theme: "theme-slate", sectionTitle: "Cover Page",
    coverTitle: "Swachhata In Lens\\nVisual Chronicle", coverYear: "2026", coverBadge: "Photojournalism", coverDate: "20th September, 2026",
    images: ["assets/jal_shakti_river.jpg", "assets/green_earth_park.jpg", "assets/smart_city_fleet.jpg"], isLocked: true
  },
  {
    id: "page-2", type: "spotlight-6", theme: "theme-slate", sectionTitle: "Ground Action in Focus",
    images: [
      "assets/sample1.jpg", "assets/safaimitra_welfare.jpg", "assets/sample3.jpg",
      "assets/green_earth_park.jpg", "assets/sample4.jpg", "assets/smart_city_fleet.jpg"
    ]
  },
  {
    id: "page-3", type: "spotlight-6", theme: "theme-slate", sectionTitle: "Community Spirit & Transformations",
    images: [
      "assets/jal_shakti_river.jpg", "assets/sample6.jpg", "assets/sample10.jpg",
      "assets/sample1.jpg", "assets/sample4.jpg", "assets/safaimitra_welfare.jpg"
    ]
  },
  {
    id: "page-4", type: "visit-us", theme: "theme-slate", sectionTitle: "Back Cover", visitText: "VISIT US", isLocked: true
  }
];

// 10. Full Hindi Standard Bulletin Template Pack
const HINDI_STANDARD_PACK = [
  {
    id: "page-1", type: "cover", theme: "theme-orange", sectionTitle: "मुखपृष्ठ",
    coverTitle: "स्वच्छता\\nही सेवा", coverYear: "2026", coverBadge: "दैनिक बुलेटिन", coverDate: "20 सितम्बर, 2026",
    images: ["assets/sample1.jpg", "assets/sample3.jpg", "assets/sample4.jpg"], isLocked: true
  },
  {
    id: "page-2", type: "snapshot", theme: "theme-orange", sectionTitle: "समग्र प्रगति अवलोकन",
    heroHeadline: "कुल नागरिक सहभागिता: 85,98,584", heroSub: "सहभागी परिवार: 27,97,819",
    stats: [
      { label: "स्वच्छता लक्षित इकाइयाँ (CTU) रूपांतरण", val1: "9,83,108 कुल लक्षित", val2: "1,59,292 रूपांतरित", val3: "59,77,214 कुल प्रतिभागी", val4: "23,201 सार्वजनिक स्थल", val5: "9,39,006 नागरिक" },
      { label: "सफाईमित्र सुरक्षा एवं सम्मान शिविर", val1: "1,382 शिविर आयोजित", val2: "8,006 सफाईकर्मी लाभान्वित", val3: "2,013 स्वास्थ्य जांच", val4: "5,393 सुरक्षा किट", val5: "14,922 योजना लाभार्थी" },
      { label: "जन-जागरूकता एवं अपशिष्ट पृथक्करण", val1: "1,05,599 विशेष अभियान", val2: "592 RRR केंद्र", val3: "16,769 हरित कार्यक्रम", val4: "23,556 खेल आयोजन", val5: "12,830 घरेलू खाद" }
    ]
  },
  {
    id: "page-3", type: "standard-3-story", theme: "theme-orange", sectionTitle: "आज की प्रमुख कहानियाँ",
    stories: [
      { headline: "आंध्र प्रदेश: मुख्यमंत्री के नेतृत्व में विशाखापट्टनम में समुद्र तट स्वच्छता अभियान", blurb: "विशाखापट्टनम के आरके बीच पर व्यापक स्वच्छता अभियान की समीक्षा की गई। गोताखोरों, मछुआरों और सफाईकर्मियों के सहयोग से समुद्री प्लास्टिक कचरा संकलन केंद्र का शुभारंभ किया गया।", images: ["assets/sample3.jpg"] },
      { headline: "सुदर्शन पटनायक ने पुरी समुद्र तट पर सफाई अभियान का किया नेतृत्व", blurb: "प्रख्यात रेत कलाकार सुदर्शन पटनायक ने स्वयंसेवकों के साथ मिलकर पुरी समुद्र तट पर जन-जागरूकता सफाई अभियान चलाया और तटीय स्वच्छता का संदेश दिया।", images: ["assets/sample4.jpg"] },
      { headline: "जोधपुर: पार्कों का कायाकल्प, 98 टन कचरा हटाया गया", blurb: "जोधपुर नगर निगम ने तीन दिवसीय विशेष स्वच्छता अभियान चलाकर 100 पार्कों का निरीक्षण किया तथा नागरिकों के साथ मिलकर पार्कों के रखरखाव का संकल्प लिया।", images: ["assets/sample6.jpg"] }
    ]
  },
  {
    id: "page-4", type: "standard-3-story", theme: "theme-orange", sectionTitle: "राज्य एवं शहरी निकाय पहल",
    stories: [
      { headline: "तिरुपति में सीटीयू स्वच्छता एवं सौंदर्यीकरण अभियान संपन्न", blurb: "तिरुपति नगर निगम द्वारा एनजीओ कॉलोनी में अधिकारियों, एनसीसी कैडेटों एवं सफाईकर्मियों की सक्रिय भागीदारी से विशेष अभियान संचालित किया गया।", images: ["assets/sample6.jpg"] },
      { headline: "विद्यार्थियों ने अपशिष्ट प्रबंधन केंद्र (MRF) का किया शैक्षणिक भ्रमण", blurb: "अंडमान एवं निकोबार द्वीप समूह के श्री विजय पुरम में स्कूली छात्र-छात्राओं को ठोस अपशिष्ट पृथक्करण और वैज्ञानिक पुनर्चक्रण की प्रणाली समझाई गई।", images: ["assets/sample10.jpg"] },
      { headline: "रीवा में प्लास्टिक मुक्ति जागरूकता हेतु नुक्कड़ नाटक का आयोजन", blurb: "मध्य प्रदेश के रीवा में नागरिकों और दुकानदारों को एकल-उपयोग प्लास्टिक के दुष्प्रभावों के प्रति जागरूक करने के लिए प्रभावी नुक्कड़ नाटक प्रस्तुत किया गया।", images: ["assets/sample4.jpg"] }
    ]
  },
  {
    id: "page-5", type: "visit-us", theme: "theme-orange", sectionTitle: "हमसे जुड़ें", visitText: "हमसे जुड़ें", isLocked: true
  }
];

// 11. Fast Field Flash (Single-Page Breaking Dispatch Pack)
const FAST_FLASH_PACK = [
  {
    id: "page-1", type: "hero-1-story", theme: "theme-crimson", sectionTitle: "Breaking Action: Daily Field Flash",
    stories: [{
      headline: "Rapid Action: 100-Hour Continuous Deep Clean Achieves Zero-Garbage Blackspots",
      blurb: "In an emergency 100-hour multi-ward cleanliness saturation drive, municipal quick-response sanitation teams cleared 34 persistent roadside waste dumps, installed 120 ornamental planters, and permanently eliminated vector breeding grounds. Citizen monitoring squads have taken charge of daily maintenance to ensure sustainable outcomes.",
      images: ["assets/green_earth_park.jpg", "assets/smart_city_fleet.jpg", "assets/sample6.jpg"]
    }],
    isLocked: false
  }
];

const DEFAULT_SEGMENTS_POOL = [
  {
    id: "seg-1",
    title: "Andhra CM Leads Ocean Cleanup at Visakhapatnam",
    category: "Top Stories",
    location: "Visakhapatnam, Andhra Pradesh",
    blurb: "At Visakhapatnam's RK Beach, Chief Minister Sh. Chandrababu Naidu reviewed the sea cleanliness drive, and virtually inaugurated the Ocean Plastic Recovery Center pilot site at Pedajalaripeta.",
    photos: ["assets/sample3.jpg", "assets/sample1.jpg"],
    status: "Ready",
    isFavorite: true
  },
  {
    id: "seg-2",
    title: "Sudarsan Pattnaik Leads Beach Clean-Up in Puri",
    category: "Top Stories",
    location: "Puri Beach, Odisha",
    blurb: "Renowned sand artist Sudarsan Pattnaik joined hands with volunteers to clean Puri Beach, reinforcing the message of collective responsibility towards coastal cleanliness.",
    photos: ["assets/sample4.jpg"],
    status: "Ready",
    isFavorite: false
  },
  {
    id: "seg-3",
    title: "Parks Get a Clean Makeover in Jodhpur; 98 tons waste cleared",
    category: "Top Stories",
    location: "Jodhpur, Rajasthan",
    blurb: "Jodhpur Municipal Corporation launched a three-day special cleanliness drive focused on the cleaning and beautification of city parks with residents adopting 22 parks.",
    photos: ["assets/sample6.jpg"],
    status: "Ready",
    isFavorite: false
  },
  {
    id: "seg-4",
    title: "CTU Cleaning & Beautification Drive in Tirupati",
    category: "State & ULB",
    location: "Tirupati, Andhra Pradesh",
    blurb: "Tirupati carried out a dedicated CTU Cleaning and Beautification Drive at NGOs Colony, marked by the active participation of officials, NCC students, and citizens.",
    photos: ["assets/sample6.jpg"],
    status: "Ready",
    isFavorite: true
  },
  {
    id: "seg-5",
    title: "Students Gain First-Hand Insight into Waste Management at MRF",
    category: "State & ULB",
    location: "Brookshabad, A&N Islands",
    blurb: "Sri Vijaya Puram Municipal Council organised an exposure visit for students to the Material Recovery Facility, briefing them on mechanized sorting and circular processing.",
    photos: ["assets/sample10.jpg"],
    status: "Ready",
    isFavorite: false
  },
  {
    id: "seg-6",
    title: "Rewa: Street Play Spreads Awareness on Plastic Ban",
    category: "State & ULB",
    location: "Rewa, Madhya Pradesh",
    blurb: "The cleanliness team in Ward No. 18 organised a street play to raise awareness among citizens and shopkeepers about the strict ban on single-use plastic items.",
    photos: ["assets/sample4.jpg"],
    status: "Ready",
    isFavorite: false
  },
  {
    id: "seg-7",
    title: "Vrindavan Waste-to-Wealth Eco-Park Restores 12-Acre Dumpsite",
    category: "State & ULB",
    location: "Vrindavan, Uttar Pradesh",
    blurb: "A former municipal dump has been transformed into a public botanical park featuring recycled metal art installations and on-site composting units.",
    photos: ["assets/green_earth_park.jpg"],
    status: "Ready",
    isFavorite: true
  },
  {
    id: "seg-8",
    title: "Naya Raipur Municipal Corporation Launches 100% Electric Sweepers",
    category: "State & ULB",
    location: "Naya Raipur, Chhattisgarh",
    blurb: "Forty-five all-electric street sweepers and GPS-connected tippers were inducted for silent, zero-emission nighttime arterial road cleaning.",
    photos: ["assets/smart_city_fleet.jpg"],
    status: "Ready",
    isFavorite: false
  },
  {
    id: "seg-9",
    title: "SafaiMitra Samman Samaroh Honors 1,200 Frontline Champions",
    category: "SafaiMitra",
    location: "Bhopal, Madhya Pradesh",
    blurb: "Sanitation heroes received certificates of honor, free healthcare screening kits, and Ayushman Bharat golden cards during a special civic felicitation camp.",
    photos: ["assets/safaimitra_welfare.jpg"],
    status: "Ready",
    isFavorite: true
  },
  {
    id: "seg-10",
    title: "Sunrise Ghat Sanitization & River Cleanup Rejuvenates Waters",
    category: "Top Stories",
    location: "Varanasi, Uttar Pradesh",
    blurb: "Volunteer pilgrims and municipal task forces united at dawn along historic riverfront stone steps, collecting floral debris and diverting it to bio-composting.",
    photos: ["assets/jal_shakti_river.jpg"],
    status: "Ready",
    isFavorite: true
  },
  {
    id: "seg-11",
    title: "Youth Cyclothon Covers 35 km for Zero-Waste Awareness",
    category: "Citizen Participation",
    location: "Chandigarh, UT",
    blurb: "Over 800 young cyclists pedaled across residential sectors, carrying informative placards on source segregation and encouraging home composting.",
    photos: ["assets/sample4.jpg"],
    status: "Ready",
    isFavorite: false
  },
  {
    id: "seg-12",
    title: "Goa RRR Drive Collects 4.8 Tonnes Usable Donated Goods",
    category: "Citizen Participation",
    location: "Panaji, Goa",
    blurb: "Forty-two housing societies mobilized used clothes, books, and children toys, redistributing them through municipal RRR centers.",
    photos: ["assets/sample6.jpg"],
    status: "Ready",
    isFavorite: false
  }
];;

// App Initialization
document.addEventListener("DOMContentLoaded", async () => {
  await initIndexedDB();
  await initStorage();
  initEventHandlers();
  initSortableSidebar();
  initScrollSpy();
  startAutoSave();
  initGeminiSettings();
  const toggleBtn = document.getElementById("btnToggleDrawer");
  if (toggleBtn) {
    toggleBtn.style.display = isDrawerOpen ? "none" : "flex";
  }
});

// Storage & History Management
async function initStorage() {
  const saved = localStorage.getItem("gov_bulletin_v2_draft");
  const timestamp = localStorage.getItem("gov_bulletin_v2_timestamp");

  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.pages && parsed.pages.length > 0) {
        // Show recovery modal allowing user to choose
        const modal = document.getElementById("recoveryModal");
        const info = document.getElementById("recoveryDraftInfo");
        const timeStr = timestamp ? new Date(timestamp).toLocaleString() : "Earlier session";
        info.innerText = `Draft details: ${parsed.pages.length} Pages | Last auto-saved: ${timeStr}`;
        modal.classList.add("open");

        document.getElementById("btnConfirmRecovery").onclick = async () => {
          modal.classList.remove("open");
          bulletin = parsed;
          await autoMigrateLegacyImages();
          renderSidebar();
          renderCanvas();
          renderSegmentDrawer();
          showToast("Previous draft restored successfully!", "success");
        };

        document.getElementById("btnDiscardRecovery").onclick = () => {
          modal.classList.remove("open");
          localStorage.removeItem("gov_bulletin_v2_draft");
          loadTemplatePack('standard_17');
          showToast("Started fresh with Standard Template", "info");
        };
        return;
      }
    } catch (e) {
      console.error("Failed to parse saved draft:", e);
    }
  }

  // Ensure segments pool is always initialized with real stories
  if (!bulletin.segments || bulletin.segments.length === 0) {
    bulletin.segments = JSON.parse(JSON.stringify(DEFAULT_SEGMENTS_POOL));
  }

  // Load custom templates
  const savedTemplates = localStorage.getItem("gov_bulletin_user_templates");
  if (savedTemplates) {
    try {
      bulletin.customTemplates = JSON.parse(savedTemplates);
    } catch (e) {}
  }

  // Initial load
  loadTemplatePack('standard_17');
}

// Migrate any legacy base64 images into IndexedDB & imageCache
async function autoMigrateLegacyImages() {
  if (!bulletin || !bulletin.pages) return;
  for (const page of bulletin.pages) {
    if (page.images) {
      for (let i = 0; i < page.images.length; i++) {
        const img = page.images[i];
        if (img && img.startsWith("data:")) {
          page.images[i] = await storeImage(img);
        }
      }
    }
    if (page.stories) {
      for (const story of page.stories) {
        if (story.images) {
          for (let i = 0; i < story.images.length; i++) {
            const img = story.images[i];
            if (img && img.startsWith("data:")) {
              story.images[i] = await storeImage(img);
            }
          }
        }
      }
    }
    if (page.ctuPairs) {
      for (const pair of page.ctuPairs) {
        if (pair.beforeImg && pair.beforeImg.startsWith("data:")) {
          pair.beforeImg = await storeImage(pair.beforeImg);
        }
        if (pair.afterImg && pair.afterImg.startsWith("data:")) {
          pair.afterImg = await storeImage(pair.afterImg);
        }
      }
    }
  }
}

function pushState() {
  // Only lightweight structural JSON is stored (~5-15KB per state)
  const snapshot = JSON.stringify(bulletin);
  if (historyStack.length >= 20) historyStack.shift();
  historyStack.push(snapshot);
  redoStack = [];
  setUnsavedStatus(true);
}

function undo() {
  if (historyStack.length === 0) return;
  redoStack.push(JSON.stringify(bulletin));
  const prevState = historyStack.pop();
  bulletin = JSON.parse(prevState);
  renderAll();
  setUnsavedStatus(true);
  showToast("Undone last edit", "info");
}

function redo() {
  if (redoStack.length === 0) return;
  historyStack.push(JSON.stringify(bulletin));
  const nextState = redoStack.pop();
  bulletin = JSON.parse(nextState);
  renderAll();
  setUnsavedStatus(true);
  showToast("Redone edit", "info");
}

function saveToLocalStorage() {
  try {
    const data = JSON.stringify(bulletin);
    // Guard: if draft exceeds 4MB, warn and skip localStorage
    if (data.length > 4 * 1024 * 1024) {
      console.warn("Draft exceeds 4MB — skipping localStorage auto-save.");
      showToast("⚠️ Draft too large for auto-save. Please download as JSON to preserve your work.", "error", 8000);
      setUnsavedStatus(true);
      return;
    }
    localStorage.setItem("gov_bulletin_v2_draft", data);
    localStorage.setItem("gov_bulletin_v2_timestamp", new Date().toISOString());
    setUnsavedStatus(false);
  } catch (e) {
    if (e.name === "QuotaExceededError") {
      showToast("⚠️ Storage full! Please download draft as JSON to avoid losing work.", "error", 8000);
      setUnsavedStatus(true);
    }
  }
}

function startAutoSave() {
  autoSaveTimer = setInterval(() => {
    if (hasUnsavedChanges) {
      saveToLocalStorage();
    }
  }, 30000); // Every 30 seconds
}

function setUnsavedStatus(unsaved) {
  hasUnsavedChanges = unsaved;
  const dot = document.getElementById("saveDot");
  const text = document.getElementById("saveStatusText");
  if (!dot || !text) return;
  if (unsaved) {
    dot.className = "dot unsaved";
    text.innerText = "Unsaved";
  } else {
    dot.className = "dot";
    text.innerText = "Auto-saved";
  }
}

// ==================== RIBBON TOOLBAR: TAB SWITCHING & THEME GALLERY ====================
const THEME_GALLERY = [
  { id: "theme-teal",    name: "National Tricolor",  swatch: ["#0f766e", "#f97316", "#14b8a6"] },
  { id: "theme-orange",  name: "Top Stories",        swatch: ["#ea580c", "#fbbf24", "#f97316"] },
  { id: "theme-navy",    name: "Executive Brief",    swatch: ["#1e3a8a", "#60a5fa", "#dbeafe"] },
  { id: "theme-emerald", name: "Green Earth",        swatch: ["#059669", "#a7f3d0", "#34d399"] },
  { id: "theme-coral",   name: "Citizen Action",     swatch: ["#e11d48", "#fda4af", "#f43f5e"] },
  { id: "theme-purple",  name: "SafaiMitra",         swatch: ["#7c3aed", "#c4b5fd", "#a78bfa"] },
  { id: "theme-cyan",    name: "Jal Shakti",         swatch: ["#0891b2", "#a5f3fc", "#22d3ee"] },
  { id: "theme-indigo",  name: "Smart City",         swatch: ["#4f46e5", "#c7d2fe", "#818cf8"] },
  { id: "theme-crimson", name: "CTU Special",        swatch: ["#dc2626", "#fecaca", "#f87171"] },
  { id: "theme-saffron", name: "Jan Andolan",        swatch: ["#d97706", "#fde68a", "#fbbf24"] },
  { id: "theme-slate",   name: "Photojournalism",    swatch: ["#334155", "#cbd5e1", "#94a3b8"] },
  { id: "theme-green",   name: "Progress Snapshot",  swatch: ["#65a30d", "#d9f99d", "#a3e635"] },
];

function initRibbonTabs() {
  const tabs = document.querySelectorAll(".ribbon-tab");
  const panels = document.querySelectorAll(".ribbon-panel");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      panels.forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const targetPanel = document.getElementById("ribbon-" + tab.getAttribute("data-panel"));
      if (targetPanel) targetPanel.classList.add("active");
    });
  });
}

function renderThemeGallery() {
  const strip = document.getElementById("themeStripGallery");
  if (!strip) return;
  strip.innerHTML = "";

  const currentTheme = bulletin.pages[activePageIndex]
    ? bulletin.pages[activePageIndex].theme
    : "theme-blue";

  THEME_GALLERY.forEach(theme => {
    const swatch = document.createElement("div");
    swatch.className = `theme-swatch ${currentTheme === theme.id ? "active" : ""}`;
    swatch.title = theme.name;
    swatch.innerHTML = theme.swatch.map(c => `<div class="theme-swatch-stripe" style="background:${c}"></div>`).join("");
    swatch.addEventListener("click", () => {
      pushState();
      if (bulletin.pages[activePageIndex]) {
        bulletin.pages[activePageIndex].theme = theme.id;
      }
      renderCanvas();
      renderThemeGallery();
      showToast(`Applied "${theme.name}" theme to Page ${activePageIndex + 1}`, "success");
    });
    strip.appendChild(swatch);
  });
}

// Event Listeners & Keyboard Shortcuts
function initEventHandlers() {
  // Initialize Ribbon Tabs
  initRibbonTabs();
  // Global Date Sync
  document.getElementById("btnSyncDate").addEventListener("click", () => {
    pushState();
    const newDate = document.getElementById("globalDateInput").value.trim();
    if (!newDate) return;
    bulletin.globalDate = newDate;
    bulletin.pages.forEach(p => {
      if (p.coverDate) p.coverDate = newDate;
    });
    renderCanvas();
    renderSidebar();
    showToast(`Updated date to "${newDate}" across all pages!`, "success");
  });

  // Language Toggle (English | Hindi | Bilingual)
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      pushState();
      document.querySelectorAll(".lang-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bulletin.language = btn.getAttribute("data-lang");
      renderCanvas();
      renderSidebar();
      showToast(`Language switched to ${btn.innerText}`, "info");
    });
  });

  // Undo / Redo buttons
  document.getElementById("btnUndo").addEventListener("click", undo);
  document.getElementById("btnRedo").addEventListener("click", redo);

  // New Bulletin / Welcome Modal
  document.getElementById("btnNewBulletin").addEventListener("click", () => {
    openWelcomeModal();
  });
  document.getElementById("btnCloseWelcomeModal").addEventListener("click", () => {
    document.getElementById("welcomeModal").classList.remove("open");
  });
  const tmplSearch = document.getElementById("templateSearchInput");
  if (tmplSearch) {
    tmplSearch.addEventListener("input", applyTemplateFilters);
  }

  // Pre-Flight Review Toggle
  document.getElementById("btnToggleReview").addEventListener("click", toggleReviewMode);
  document.getElementById("btnCloseReviewModal").addEventListener("click", () => {
    document.getElementById("reviewModal").classList.remove("open");
  });
  document.getElementById("btnDismissReview").addEventListener("click", () => {
    document.getElementById("reviewModal").classList.remove("open");
  });
  document.getElementById("btnProceedToExport").addEventListener("click", () => {
    document.getElementById("reviewModal").classList.remove("open");
    openExportModal();
  });

  // Save / Draft Actions (Ribbon — direct buttons, no dropdowns)
  document.getElementById("btnSaveDraftJson").addEventListener("click", downloadDraftJson);
  document.getElementById("btnSaveAsTemplate").addEventListener("click", openSaveTemplateModal);
  document.getElementById("btnCloneYesterday").addEventListener("click", triggerCloneYesterday);

  // Export Actions (Ribbon — direct buttons)
  document.getElementById("btnExportPrintPdf").addEventListener("click", () => {
    openExportModal("print");
  });
  document.getElementById("btnExportWhatsAppPdf").addEventListener("click", () => {
    openExportModal("whatsapp");
  });

  // Theme Scope: Apply active theme to all pages
  const btnApplyAll = document.getElementById("btnApplyThemeAll");
  if (btnApplyAll) {
    btnApplyAll.addEventListener("click", () => {
      const activeTheme = bulletin.pages[activePageIndex]?.theme || "theme-blue";
      pushState();
      bulletin.pages.forEach(p => p.theme = activeTheme);
      renderCanvas();
      renderSidebar();
      renderThemeGallery();
      showToast(`Applied "${activeTheme}" across all ${bulletin.pages.length} pages!`, "success");
    });
  }

  // Export panel duplicate draft buttons
  const btnSaveDraftExport = document.getElementById("btnSaveDraftJsonExport");
  if (btnSaveDraftExport) btnSaveDraftExport.addEventListener("click", downloadDraftJson);
  const fileLoadExport = document.getElementById("fileLoadDraftExport");
  if (fileLoadExport) fileLoadExport.addEventListener("change", (e) => loadDraftFromFile(e.target.files[0]));

  // Export Modal Actions
  document.getElementById("btnCloseExportModal").addEventListener("click", () => {
    document.getElementById("exportModal").classList.remove("open");
  });
  document.getElementById("btnSelectAllExport").addEventListener("click", () => toggleAllExportPages(true));
  document.getElementById("btnDeselectAllExport").addEventListener("click", () => toggleAllExportPages(false));
  document.getElementById("btnTriggerHiResPrint").addEventListener("click", () => exportSelectedPages("print"));
  document.getElementById("btnTriggerWhatsAppDownload").addEventListener("click", () => exportSelectedPages("whatsapp"));

  // Gemini AI Settings Modal Actions
  document.getElementById("btnOpenGeminiSettings").addEventListener("click", openGeminiSettings);
  document.getElementById("btnOpenGeminiSettingsHome")?.addEventListener("click", openGeminiSettings);
  document.getElementById("btnCloseGeminiModal").addEventListener("click", () => {
    document.getElementById("geminiSettingsModal").classList.remove("open");
  });
  document.getElementById("btnSaveGeminiKey").addEventListener("click", saveGeminiKey);
  document.getElementById("btnClearGeminiKey").addEventListener("click", clearGeminiKey);
  document.getElementById("btnTestGeminiKey").addEventListener("click", testGeminiKey);

  // Bulk Ingestion Modal Actions
  document.getElementById("btnCloseBulkIngestModal").addEventListener("click", () => {
    document.getElementById("bulkIngestModal").classList.remove("open");
  });
  document.getElementById("btnCancelBulkIngest").addEventListener("click", () => {
    document.getElementById("bulkIngestModal").classList.remove("open");
  });
  document.getElementById("btnConfirmBulkIngest").addEventListener("click", handleBulkIngestSubmit);
  document.getElementById("btnOpenBulkIngestTop")?.addEventListener("click", openBulkIngestModal);

  // Load Draft JSON
  document.getElementById("fileLoadDraft").addEventListener("change", handleLoadDraftFile);
  document.getElementById("fileLoadDraftWelcome").addEventListener("change", handleLoadDraftFile);

  // Shortcuts & Logos
  document.getElementById("btnShortcutsHelp").addEventListener("click", () => {
    document.getElementById("shortcutsModal").classList.add("open");
  });
  document.getElementById("btnCloseShortcutsModal").addEventListener("click", () => {
    document.getElementById("shortcutsModal").classList.remove("open");
  });
  document.getElementById("btnDismissShortcuts").addEventListener("click", () => {
    document.getElementById("shortcutsModal").classList.remove("open");
  });

  document.getElementById("btnOpenLogoModal").addEventListener("click", openLogoModal);
  document.getElementById("btnCloseLogoModal").addEventListener("click", () => {
    saveLogosConfig();
  });
  document.getElementById("btnSaveLogos").addEventListener("click", saveLogosConfig);
  document.getElementById("btnResetDefaultLogos").addEventListener("click", resetDefaultLogos);
  
  // Real-time logo toggles & immediate canvas update
  document.getElementById("chkLogoJalShakti").addEventListener("change", onLogoToggleChange);
  document.getElementById("chkLogoSwachhata").addEventListener("change", onLogoToggleChange);
  document.getElementById("chkLogoMoHUA").addEventListener("change", onLogoToggleChange);
  document.getElementById("customLogoUploader").addEventListener("change", handleCustomLogoUpload);
  document.getElementById("btnClearCustomLogo").addEventListener("click", clearCustomLogo);

  // AI Modal & Key Banner
  document.getElementById("btnOpenAIModal").addEventListener("click", () => {
    updateGeminiStatusUI();
    document.getElementById("aiModal").classList.add("open");
  });
  document.getElementById("btnCloseAIModal").addEventListener("click", () => {
    document.getElementById("aiModal").classList.remove("open");
  });
  document.getElementById("btnConfigureKeyInAiModal").addEventListener("click", () => {
    document.getElementById("aiModal").classList.remove("open");
    openGeminiSettings();
  });
  document.getElementById("btnToggleShowKey").addEventListener("click", toggleShowGeminiKey);
  document.getElementById("btnRunAiGenerate").addEventListener("click", runAiGenerateCopy);
  document.getElementById("btnApplyAiToSegment").addEventListener("click", saveAiToSegment);
  document.getElementById("btnApplyAiToPage").addEventListener("click", applyAiToActivePage);

  // Segment Drawer Toggle
  document.getElementById("btnToggleDrawer").addEventListener("click", toggleDrawer);
  document.getElementById("btnCloseDrawer").addEventListener("click", toggleDrawer);

  // Drawer Tabs
  document.querySelectorAll(".drawer-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".drawer-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderDrawerTab(btn.getAttribute("data-tab"));
    });
  });

  // Sidebar Page Actions
  document.getElementById("btnAddPageMenu").addEventListener("click", showAddPagePrompt);
  document.getElementById("btnDuplicateActivePage").addEventListener("click", () => duplicatePage(activePageIndex));
  document.getElementById("btnDeleteActivePage").addEventListener("click", () => deletePage(activePageIndex));

  // Image Cropper Modal Actions
  document.getElementById("btnCloseCropModal").addEventListener("click", closeCropModal);
  document.getElementById("btnCancelCrop").addEventListener("click", closeCropModal);
  document.getElementById("btnApplyCrop").addEventListener("click", applyCropResult);

  // Save as Template Modal Actions
  document.getElementById("btnCloseSaveTemplateModal").addEventListener("click", () => {
    document.getElementById("saveTemplateModal").classList.remove("open");
  });
  document.getElementById("btnCancelSaveTemplate").addEventListener("click", () => {
    document.getElementById("saveTemplateModal").classList.remove("open");
  });
  document.getElementById("btnConfirmSaveTemplate").addEventListener("click", confirmSaveCustomTemplate);

  // File Upload Handlers
  document.getElementById("slotImageUploader").addEventListener("change", handleSlotImageUploaded);
  document.getElementById("segmentPhotoUploader").addEventListener("change", handleSegmentPhotoUploaded);
  document.getElementById("bulkPhotoInput").addEventListener("change", handleBulkPhotosUploaded);

  // Global Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      downloadDraftJson();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      exportPrintPdf();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openWelcomeModal();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicatePage(activePageIndex);
    } else if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop").forEach(m => m.classList.remove("open"));
      document.querySelectorAll(".dropdown").forEach(d => d.classList.remove("open"));
    } else if (e.key === "?" && !isInputFocused()) {
      e.preventDefault();
      document.getElementById("shortcutsModal").classList.add("open");
    }
  });

  // (Old dropdown close handlers removed — ribbon tabs don't need them)
}

function isInputFocused() {
  const tag = document.activeElement ? document.activeElement.tagName : "";
  return tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement && document.activeElement.isContentEditable);
}

// Fixed Sidebar & SortableJS Reordering
function initSortableSidebar() {
  const list = document.getElementById("sidebarPageList");
  if (typeof Sortable !== "undefined") {
    Sortable.create(list, {
      handle: ".thumb-handle",
      animation: 150,
      onEnd: (evt) => {
        pushState();
        const movedItem = bulletin.pages.splice(evt.oldIndex, 1)[0];
        bulletin.pages.splice(evt.newIndex, 0, movedItem);
        activePageIndex = evt.newIndex;
        renderAll();
      }
    });
  }
}

// ScrollSpy: Highlights active thumbnail as user scrolls through A4 canvas
function initScrollSpy() {
  const viewport = document.getElementById("canvasViewport");
  viewport.addEventListener("scroll", () => {
    const pageEls = document.querySelectorAll(".a4-page");
    const viewportTop = viewport.scrollTop;
    let closestIndex = 0;
    let minDistance = Infinity;

    pageEls.forEach((el, idx) => {
      const distance = Math.abs(el.offsetTop - viewportTop - 40);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = idx;
      }
    });

    if (closestIndex !== activePageIndex) {
      activePageIndex = closestIndex;
      updateSidebarActiveItem();
    }
  });
}

const THEME_ACCENT_COLORS = {
  "theme-teal": "#0f766e",
  "theme-orange": "#ea580c",
  "theme-navy": "#1e3a8a",
  "theme-emerald": "#059669",
  "theme-coral": "#e11d48",
  "theme-purple": "#7c3aed",
  "theme-cyan": "#0891b2",
  "theme-indigo": "#4f46e5",
  "theme-crimson": "#dc2626",
  "theme-saffron": "#d97706",
  "theme-slate": "#334155",
  "theme-green": "#65a30d",
  "theme-blue": "#0284c7"
};

function buildSlideMiniPreviewHtml(page) {
  const accent = THEME_ACCENT_COLORS[page.theme] || "#0284c7";
  let bodyHtml = "";

  if (page.type === "cover") {
    bodyHtml = `
      <div class="slide-wire-row" style="flex: 1.5; gap: 3px;">
        <div class="slide-wire-box hero-box" style="flex: 1.4;"></div>
        <div style="flex: 1; display:flex; flex-direction:column; gap:2px;">
          <div class="slide-wire-box" style="flex: 1;"></div>
          <div class="slide-wire-box" style="flex: 1;"></div>
        </div>
      </div>
      <div style="height: 18px; display:flex; flex-direction:column; justify-content:center; gap:2px; padding: 2px 0;">
        <div class="slide-wire-title" style="width: 80%; height: 5px; background: ${accent};"></div>
        <div class="slide-wire-sub" style="width: 50%; height: 3px;"></div>
      </div>
    `;
  } else if (page.type === "snapshot") {
    bodyHtml = `
      <div class="slide-wire-title" style="width: 60%; height: 4px; background: ${accent};"></div>
      <div style="height: 10px; background: #e0f2fe; border-radius: 2px; margin-bottom: 2px;"></div>
      <div style="display:flex; flex-direction:column; gap:2px; flex:1;">
        <div style="height: 5px; background: #f1f5f9; border-radius: 1px;"></div>
        <div style="height: 5px; background: #f8fafc; border-radius: 1px;"></div>
        <div style="height: 5px; background: #f1f5f9; border-radius: 1px;"></div>
      </div>
    `;
  } else if (page.type === "ctu-transformation") {
    bodyHtml = `
      <div class="slide-wire-title" style="width: 75%; height: 4px; background: ${accent}; margin-bottom: 3px;"></div>
      <div class="slide-wire-row" style="flex:1; gap:4px;">
        <div class="slide-wire-box red-box" style="display:flex; align-items:center; justify-content:center; font-size:7px; color:#ef4444; font-weight:800;">BEFORE</div>
        <div class="slide-wire-box green-box" style="display:flex; align-items:center; justify-content:center; font-size:7px; color:#10b981; font-weight:800;">AFTER</div>
      </div>
    `;
  } else if (page.type === "spotlight-6") {
    bodyHtml = `
      <div class="slide-wire-title" style="width: 70%; height: 4px; background: ${accent}; margin-bottom: 2px;"></div>
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 2px; flex: 1;">
        <div class="slide-wire-box"></div>
        <div class="slide-wire-box"></div>
        <div class="slide-wire-box"></div>
        <div class="slide-wire-box"></div>
        <div class="slide-wire-box"></div>
        <div class="slide-wire-box"></div>
      </div>
    `;
  } else if (page.type === "split-2-story") {
    bodyHtml = `
      <div class="slide-wire-title" style="width: 65%; height: 4px; background: ${accent}; margin-bottom: 2px;"></div>
      <div class="slide-wire-row" style="flex: 1; gap: 4px;">
        <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
          <div class="slide-wire-sub" style="width: 90%;"></div>
          <div class="slide-wire-box" style="flex:1;"></div>
        </div>
        <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
          <div class="slide-wire-sub" style="width: 90%;"></div>
          <div class="slide-wire-box" style="flex:1;"></div>
        </div>
      </div>
    `;
  } else if (page.type === "visit-us") {
    bodyHtml = `
      <div class="slide-wire-title" style="width: 50%; height: 4px; background: ${accent}; margin: 2px auto;"></div>
      <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;">
        <div style="width: 16px; height: 16px; border-radius: 50%; background: #e2e8f0;"></div>
        <div class="slide-wire-sub" style="width: 60%;"></div>
      </div>
    `;
  } else {
    bodyHtml = `
      <div class="slide-wire-title" style="width: 70%; height: 4px; background: ${accent}; margin-bottom: 2px;"></div>
      <div class="slide-wire-row" style="flex: 1; gap: 4px;">
        <div style="flex: 1.2; display:flex; flex-direction:column; gap:2px;">
          <div class="slide-wire-sub" style="width: 100%;"></div>
          <div class="slide-wire-sub" style="width: 80%;"></div>
        </div>
        <div class="slide-wire-box" style="flex: 0.8;"></div>
      </div>
      <div class="slide-wire-row" style="flex: 1; gap: 4px;">
        <div class="slide-wire-box" style="flex: 0.8;"></div>
        <div style="flex: 1.2; display:flex; flex-direction:column; gap:2px;">
          <div class="slide-wire-sub" style="width: 100%;"></div>
        </div>
      </div>
    `;
  }

  return `
    <div class="slide-preview-box">
      <div class="slide-preview-accent" style="background: ${accent};"></div>
      <div class="slide-preview-header">
        <div class="slide-preview-header-dots">
          <div class="slide-preview-dot"></div>
          <div class="slide-preview-dot"></div>
        </div>
        <div style="font-size: 6px; color: #94a3b8; font-weight: 700;">GOV</div>
      </div>
      <div class="slide-preview-body">
        ${bodyHtml}
      </div>
      <div class="slide-preview-footer"></div>
    </div>
  `;
}

function updateSidebarActiveItem() {
  document.querySelectorAll(".slide-thumb-card").forEach((item, idx) => {
    if (idx === activePageIndex) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });
  document.getElementById("pageCountDisplay").innerText = `Slide ${activePageIndex + 1} of ${bulletin.pages.length}`;
}

// Render All Components
function renderAll() {
  renderSidebar();
  renderCanvas();
  renderSegmentDrawer();
  renderThemeGallery();
}

// Render Left Sidebar Thumbnails
function renderSidebar() {
  const list = document.getElementById("sidebarPageList");
  if (!list) return;
  list.innerHTML = "";

  bulletin.pages.forEach((page, idx) => {
    const item = document.createElement("div");
    item.className = `slide-thumb-card ${idx === activePageIndex ? "active" : ""}`;
    item.onclick = () => {
      activePageIndex = idx;
      updateSidebarActiveItem();
      renderThemeGallery();
      scrollToPage(idx);
    };

    let title = getLocalizedSectionTitle(page.sectionTitle);
    if (page.type === "cover") title = "Cover: " + (page.coverTitle ? page.coverTitle.replace("\n", " ") : "Bulletin");

    let icon = "📄";
    if (page.type === "cover") icon = "🏠";
    else if (page.type === "snapshot") icon = "📊";
    else if (page.type === "ctu-transformation") icon = "🔄";
    else if (page.type === "spotlight-6") icon = "📱";
    else if (page.type === "visit-us") icon = "🔗";

    item.innerHTML = `
      <div class="slide-thumb-top">
        <div style="display: flex; align-items: center; gap: 5px;">
          <span class="thumb-handle" title="Drag to reorder">⋮⋮</span>
          <span class="slide-num-pill">${idx + 1}</span>
        </div>
        <span style="font-size: 11px;">${icon}</span>
      </div>
      ${buildSlideMiniPreviewHtml(page)}
      <div class="slide-thumb-meta">
        <span class="slide-thumb-title" title="${escapeHtml(title)}">${title}</span>
        <div class="slide-thumb-actions">
          <button class="btn-tiny" title="Duplicate Slide" onclick="event.stopPropagation(); duplicatePage(${idx})">📋</button>
          <button class="btn-tiny delete" title="Delete Slide" onclick="event.stopPropagation(); deletePage(${idx})">✕</button>
        </div>
      </div>
    `;
    list.appendChild(item);
  });

  document.getElementById("pageCountDisplay").innerText = `Slides (${bulletin.pages.length})`;
}

function scrollToPage(idx) {
  const el = document.getElementById(`page-card-${idx}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function duplicatePage(idx) {
  pushState();
  const copy = JSON.parse(JSON.stringify(bulletin.pages[idx]));
  copy.id = "p-" + Date.now();
  bulletin.pages.splice(idx + 1, 0, copy);
  activePageIndex = idx + 1;
  renderAll();
  scrollToPage(activePageIndex);
}

function deletePage(idx) {
  if (bulletin.pages.length <= 1) {
    showToast("You must keep at least 1 page in the bulletin.", "warn");
    return;
  }
  showInlineConfirm(`Delete Page ${idx + 1}?`, () => {
    pushState();
    bulletin.pages.splice(idx, 1);
    if (activePageIndex >= bulletin.pages.length) activePageIndex = bulletin.pages.length - 1;
    renderAll();
    showToast(`Page ${idx + 1} deleted`, "info");
  });
}

function movePage(index, dir) {
  const target = index + dir;
  if (target < 0 || target >= bulletin.pages.length) return;
  pushState();
  const temp = bulletin.pages[index];
  bulletin.pages[index] = bulletin.pages[target];
  bulletin.pages[target] = temp;
  activePageIndex = target;
  renderAll();
  scrollToPage(activePageIndex);
}

// Render Canvas: A4 Pages
function renderCanvas() {
  const container = document.getElementById("canvasViewport");
  container.innerHTML = "";

  bulletin.pages.forEach((page, pIdx) => {
    const pageEl = document.createElement("div");
    pageEl.className = `a4-page ${page.theme || "theme-blue"}`;
    pageEl.id = `page-card-${pIdx}`;

    // Floating Toolbar for Page
    const toolbar = document.createElement("div");
    toolbar.className = "page-toolbar";
    toolbar.innerHTML = `
      <select onchange="updatePageTheme(${pIdx}, this.value)">
        <option value="theme-orange" ${page.theme === "theme-orange" ? "selected" : ""}>Orange (Top Stories)</option>
        <option value="theme-blue" ${page.theme === "theme-blue" ? "selected" : ""}>Blue (State & ULB)</option>
        <option value="theme-coral" ${page.theme === "theme-coral" ? "selected" : ""}>Coral (Citizen / CTU)</option>
        <option value="theme-purple" ${page.theme === "theme-purple" ? "selected" : ""}>Purple (SafaiMitra / Welfare)</option>
        <option value="theme-green" ${page.theme === "theme-green" ? "selected" : ""}>Green (Snapshot)</option>
        <option value="theme-teal" ${page.theme === "theme-teal" ? "selected" : ""}>Teal (National Standard)</option>
        <option value="theme-saffron" ${page.theme === "theme-saffron" ? "selected" : ""}>Saffron (Jan Andolan)</option>
        <option value="theme-navy" ${page.theme === "theme-navy" ? "selected" : ""}>Navy (Executive Brief)</option>
        <option value="theme-emerald" ${page.theme === "theme-emerald" ? "selected" : ""}>Emerald (Green Earth / RRR)</option>
        <option value="theme-crimson" ${page.theme === "theme-crimson" ? "selected" : ""}>Crimson (CTU Transformation)</option>
        <option value="theme-indigo" ${page.theme === "theme-indigo" ? "selected" : ""}>Indigo (Smart City Ops)</option>
        <option value="theme-cyan" ${page.theme === "theme-cyan" ? "selected" : ""}>Cyan (Jal Shakti & Oceans)</option>
        <option value="theme-slate" ${page.theme === "theme-slate" ? "selected" : ""}>Slate (Photojournalism)</option>
      </select>
      <button class="lock-btn" title="Toggle Lock" onclick="togglePageLock(${pIdx})">${page.isLocked ? "🔒 Locked" : "🔓 Lock"}</button>
      <button onclick="duplicatePage(${pIdx})">Copy</button>
      <button onclick="deletePage(${pIdx})">Delete</button>
    `;
    pageEl.appendChild(toolbar);

    // Official Header Strip (with emblems)
    const headerStrip = document.createElement("div");
    headerStrip.className = "page-header-logos";
    headerStrip.innerHTML = buildHeaderLogosHtml(page);
    pageEl.appendChild(headerStrip);

    // Render Page Body by Type
    if (page.type === "cover") {
      renderCoverPage(pageEl, page, pIdx);
    } else if (page.type === "snapshot") {
      renderSnapshotPage(pageEl, page, pIdx);
    } else if (page.type === "ctu-transformation") {
      renderCtuTransformationPage(pageEl, page, pIdx);
    } else if (page.type === "spotlight-6") {
      renderSpotlightPage(pageEl, page, pIdx);
    } else if (page.type === "visit-us") {
      renderVisitUsPage(pageEl, page, pIdx);
    } else {
      renderEditorialPage(pageEl, page, pIdx);
    }

    // Dynamic Footer (Page X of Y)
    const footer = document.createElement("div");
    footer.className = "page-footer-bar";
    if (page.type !== "cover") {
      footer.innerHTML = `<span>Page ${pIdx + 1} of ${bulletin.pages.length}</span>`;
    }
    pageEl.appendChild(footer);

    container.appendChild(pageEl);
  });
}

function updatePageTheme(pIdx, newTheme) {
  pushState();
  bulletin.pages[pIdx].theme = newTheme;
  renderCanvas();
}

function togglePageLock(pIdx) {
  pushState();
  bulletin.pages[pIdx].isLocked = !bulletin.pages[pIdx].isLocked;
  renderCanvas();
}

// Section Banner Builder with Hindi / Bilingual Support
function createSectionBanner(page, pIdx) {
  const dateParts = parseDateString(bulletin.globalDate);
  const banner = document.createElement("div");
  banner.className = `section-banner ${page.theme || "theme-blue"}`;

  let primaryTitle = page.sectionTitle;
  let hindiSubtitle = "";

  if (bulletin.language === "hi") {
    primaryTitle = getLocalizedSectionTitle(page.sectionTitle);
  } else if (bulletin.language === "bi") {
    hindiSubtitle = getLocalizedSectionTitle(page.sectionTitle);
  }

  banner.innerHTML = `
    <div class="date-block">
      <div class="date-day">${dateParts.day}</div>
      <div class="date-month-year">${dateParts.rest}</div>
    </div>
    <div class="section-title-block">
      <div>
        <span class="section-title-text" contenteditable="${!page.isLocked}" onblur="updateSectionTitle(${pIdx}, this.innerText)">${primaryTitle}</span>
        ${hindiSubtitle && hindiSubtitle !== primaryTitle ? `<span class="section-title-sub-hindi">${hindiSubtitle}</span>` : ''}
      </div>
    </div>
  `;
  return banner;
}

function getLocalizedSectionTitle(enTitle) {
  if (GOV_DICT[enTitle] && GOV_DICT[enTitle].hi) {
    return GOV_DICT[enTitle].hi;
  }
  return enTitle;
}

function updateSectionTitle(pIdx, val) {
  bulletin.pages[pIdx].sectionTitle = val.trim();
  renderSidebar();
}

// 1. Cover Page
function renderCoverPage(pageEl, page, pIdx) {
  const content = document.createElement("div");
  content.className = "cover-page-content";

  content.innerHTML = `
    <div class="cover-grid">
      <div class="cover-hero-img image-placeholder-box ${!page.images[0] ? 'empty' : ''}" 
           onclick="triggerSlotUpload(${pIdx}, 0, 0, true)"
           ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, 0, 0, true)">
        <img src="${page.images[0] || 'assets/sample1.jpg'}" alt="Cover Hero">
        <div class="image-actions-overlay">
          <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, 0, 0, true)">📁 Upload</button>
          <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, 0, 0, true)">✂️ Crop</button>
        </div>
      </div>
      <div class="cover-side-stack">
        <div class="cover-side-img image-placeholder-box ${!page.images[1] ? 'empty' : ''}" 
             onclick="triggerSlotUpload(${pIdx}, 0, 1, true)"
             ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, 0, 1, true)">
          <img src="${page.images[1] || 'assets/sample3.jpg'}" alt="Cover Side 1">
          <div class="image-actions-overlay">
            <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, 0, 1, true)">📁 Upload</button>
            <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, 0, 1, true)">✂️ Crop</button>
          </div>
        </div>
        <div class="cover-side-img image-placeholder-box ${!page.images[2] ? 'empty' : ''}" 
             onclick="triggerSlotUpload(${pIdx}, 0, 2, true)"
             ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, 0, 2, true)">
          <img src="${page.images[2] || 'assets/sample4.jpg'}" alt="Cover Side 2">
          <div class="image-actions-overlay">
            <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, 0, 2, true)">📁 Upload</button>
            <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, 0, 2, true)">✂️ Crop</button>
          </div>
        </div>
      </div>
    </div>

    <div class="cover-title-area">
      <h1 class="cover-main-heading" contenteditable="${!page.isLocked}" onblur="bulletin.pages[${pIdx}].coverTitle = this.innerText">${page.coverTitle || 'Swachhata\nHi Seva'}</h1>
      <div class="cover-year">
        <span contenteditable="${!page.isLocked}" onblur="bulletin.pages[${pIdx}].coverYear = this.innerText">${page.coverYear || '2026'}</span>
        <span class="cover-date-tag" contenteditable="${!page.isLocked}" onblur="bulletin.pages[${pIdx}].coverDate = this.innerText">${page.coverDate || bulletin.globalDate}</span>
      </div>
      <div class="cover-pill-badge" contenteditable="${!page.isLocked}" onblur="bulletin.pages[${pIdx}].coverBadge = this.innerText">${page.coverBadge || 'Bulletin'}</div>
    </div>
  `;
  pageEl.appendChild(content);
}

// 2. Snapshot Page (Stats Table)
function renderSnapshotPage(pageEl, page, pIdx) {
  pageEl.appendChild(createSectionBanner(page, pIdx));
  const content = document.createElement("div");
  content.className = "page-content-area";

  let tableRowsHtml = "";
  if (page.stats) {
    page.stats.forEach((row, rIdx) => {
      tableRowsHtml += `
        <tr>
          <td style="font-weight:700; text-align:left; background:#e2f5b4;" contenteditable="${!page.isLocked}">${row.label}</td>
          <td contenteditable="${!page.isLocked}">${row.val1}</td>
          <td contenteditable="${!page.isLocked}">${row.val2}</td>
          <td contenteditable="${!page.isLocked}">${row.val3}</td>
          <td contenteditable="${!page.isLocked}">${row.val4}</td>
          <td contenteditable="${!page.isLocked}">${row.val5}</td>
        </tr>
      `;
    });
  }

  content.innerHTML = `
    <div class="snapshot-hero-metric">
      <div class="snapshot-hero-title" contenteditable="${!page.isLocked}">${page.heroHeadline || 'Overall Citizens Participation: 85,98,584'}</div>
      <div class="snapshot-hero-sub" contenteditable="${!page.isLocked}">${page.heroSub || 'Households Participated: 27,97,819'}</div>
    </div>
    <table class="snapshot-table">
      <thead>
        <tr>
          <th>Pillar / Focus Area</th>
          <th>Metric 1</th>
          <th>Metric 2</th>
          <th>Metric 3</th>
          <th>Metric 4</th>
          <th>Metric 5</th>
        </tr>
      </thead>
      <tbody>
        ${tableRowsHtml}
      </tbody>
    </table>
    <div style="font-size: 11px; color: #64748b; font-style: italic; margin-top: 4px;">
      *As updated on the National Swachhata Portal. Real-time metrics across all States/UTs.
    </div>
  `;
  pageEl.appendChild(content);
}

// 3. Before & After Transformation Page (2 or 3 pairs)
function renderCtuTransformationPage(pageEl, page, pIdx) {
  pageEl.appendChild(createSectionBanner(page, pIdx));
  const content = document.createElement("div");
  content.className = "page-content-area";

  const pairCount = page.pairCount || 2;
  const pairs = page.ctuPairs || [];

  let pairsHtml = "";
  for (let i = 0; i < pairCount; i++) {
    const pair = pairs[i] || {
      title: `Cleanliness Target Unit #${i + 1}`,
      location: "Municipal Ward Location",
      beforeImg: "assets/sample10.jpg",
      afterImg: "assets/sample6.jpg",
      beforeDate: "15th Sept",
      afterDate: "20th Sept",
      desc: "Waste cleared, transformed and restored into a beautified public space."
    };

    pairsHtml += `
      <div class="ctu-pair-card">
        <div class="ctu-caption-area">
          <span class="ctu-title" contenteditable="${!page.isLocked}" onblur="updateCtuField(${pIdx}, ${i}, 'title', this.innerText)">${pair.title}</span>
          <span class="ctu-desc" contenteditable="${!page.isLocked}" onblur="updateCtuField(${pIdx}, ${i}, 'location', this.innerText)">📍 ${pair.location}</span>
        </div>
        <div class="ctu-photos-row">
          <div class="ctu-photo-half">
            <span class="ctu-badge ctu-badge-before">BEFORE (${pair.beforeDate})</span>
            <div class="image-placeholder-box ${!pair.beforeImg ? 'empty' : ''}" 
                 onclick="triggerCtuUpload(${pIdx}, ${i}, 'before')"
                 ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleCtuFileDrop(event, ${pIdx}, ${i}, 'before')">
              <img src="${pair.beforeImg || 'assets/sample10.jpg'}" alt="Before Transformation">
              <div class="image-actions-overlay">
                <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerCtuUpload(${pIdx}, ${i}, 'before')">📁 Upload</button>
                <button onclick="event.stopPropagation(); openCropperForCtu(${pIdx}, ${i}, 'before')">✂️ Crop</button>
              </div>
            </div>
          </div>
          <div class="ctu-photo-half">
            <span class="ctu-badge ctu-badge-after">AFTER (${pair.afterDate})</span>
            <div class="image-placeholder-box ${!pair.afterImg ? 'empty' : ''}" 
                 onclick="triggerCtuUpload(${pIdx}, ${i}, 'after')"
                 ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleCtuFileDrop(event, ${pIdx}, ${i}, 'after')">
              <img src="${pair.afterImg || 'assets/sample6.jpg'}" alt="After Transformation">
              <div class="image-actions-overlay">
                <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerCtuUpload(${pIdx}, ${i}, 'after')">📁 Upload</button>
                <button onclick="event.stopPropagation(); openCropperForCtu(${pIdx}, ${i}, 'after')">✂️ Crop</button>
              </div>
            </div>
          </div>
        </div>
        <div class="ctu-desc" style="margin-top: 3px;" contenteditable="${!page.isLocked}" onblur="updateCtuField(${pIdx}, ${i}, 'desc', this.innerText)">${pair.desc}</div>
      </div>
    `;
  }

  content.innerHTML = `
    <div style="display: flex; justify-content: flex-end; margin-bottom: -10px;">
      <select onchange="updateCtuPairCount(${pIdx}, this.value)" style="font-size: 11px; background:#f1f5f9; border:1px solid #cbd5e1; padding:2px 6px; border-radius:4px;">
        <option value="2" ${pairCount === 2 ? 'selected' : ''}>Layout: 2 Before/After Pairs</option>
        <option value="3" ${pairCount === 3 ? 'selected' : ''}>Layout: 3 Before/After Pairs</option>
      </select>
    </div>
    <div class="ctu-pairs-container">
      ${pairsHtml}
    </div>
  `;
  pageEl.appendChild(content);
}

function updateCtuPairCount(pIdx, count) {
  pushState();
  bulletin.pages[pIdx].pairCount = parseInt(count, 10);
  renderCanvas();
}

function updateCtuField(pIdx, pairIdx, field, val) {
  if (!bulletin.pages[pIdx].ctuPairs) bulletin.pages[pIdx].ctuPairs = [];
  if (!bulletin.pages[pIdx].ctuPairs[pairIdx]) bulletin.pages[pIdx].ctuPairs[pairIdx] = {};
  bulletin.pages[pIdx].ctuPairs[pairIdx][field] = val.trim();
}

// 4. Editorial Stories (1-Story, 2-Story, 3-Story)
function renderEditorialPage(pageEl, page, pIdx) {
  pageEl.appendChild(createSectionBanner(page, pIdx));
  const content = document.createElement("div");
  content.className = "page-content-area";

  if (page.type === "hero-1-story") {
    const story = (page.stories && page.stories[0]) || { headline: "Enter Major Headline Here", blurb: "Enter story description...", images: [] };
    content.innerHTML = `
      <div class="layout-hero-story" style="display:flex; flex-direction:column; gap:14px; height:100%;">
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <h2 class="story-headline ${story.headline.includes('Enter') ? 'placeholder-text' : ''}" style="font-size: 22px; flex: 1;" contenteditable="${!page.isLocked}" onblur="updateStoryHeadline(${pIdx}, 0, this.innerText)">${story.headline}</h2>
          <div style="display: flex; gap: 4px;">
            <button class="btn-tiny" onclick="adjustStoryFontSize(${pIdx}, 0, 1)">A+</button>
            <button class="btn-tiny" onclick="adjustStoryFontSize(${pIdx}, 0, -1)">A-</button>
          </div>
        </div>
        <div style="display: flex; gap: 18px; align-items: flex-start;">
          <div class="story-blurb" style="font-size: 14px; flex: 1.1;" contenteditable="${!page.isLocked}" onblur="updateStoryBlurb(${pIdx}, 0, this.innerText)">${story.blurb}</div>
          <button class="btn-trim-ai" onclick="triggerAiTrim(this)" title="AI-condense overflowing text" style="align-self: flex-start; font-size: 10px; padding: 2px 8px; background: #334155; color: #a78bfa; border: 1px solid #6366f1; border-radius: 4px; cursor: pointer; margin-top: 4px;">✂️ AI Trim</button>
          <div class="image-placeholder-box ${!story.images[0] ? 'empty' : ''}" style="flex: 0.9; height: 230px;" 
               onclick="triggerSlotUpload(${pIdx}, 0, 0)"
               ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, 0, 0)">
            <img src="${story.images[0] || 'assets/sample3.jpg'}" alt="Story Main Photo">
            <div class="image-actions-overlay">
              <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, 0, 0)">📁 Upload</button>
              <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, 0, 0)">✂️ Crop</button>
            </div>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex: 1;">
          <div class="image-placeholder-box ${!story.images[1] ? 'empty' : ''}" style="height: 250px;" 
               onclick="triggerSlotUpload(${pIdx}, 0, 1)"
               ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, 0, 1)">
            <img src="${story.images[1] || 'assets/sample1.jpg'}" alt="Story Secondary Photo">
            <div class="image-actions-overlay">
              <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, 0, 1)">📁 Upload</button>
              <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, 0, 1)">✂️ Crop</button>
            </div>
          </div>
          <div class="image-placeholder-box ${!story.images[2] ? 'empty' : ''}" style="height: 250px;" 
               onclick="triggerSlotUpload(${pIdx}, 0, 2)"
               ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, 0, 2)">
            <img src="${story.images[2] || story.images[0] || 'assets/sample4.jpg'}" alt="Story Action Photo">
            <div class="image-actions-overlay">
              <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, 0, 2)">📁 Upload</button>
              <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, 0, 2)">✂️ Crop</button>
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (page.type === "split-2-story") {
    const s1 = (page.stories && page.stories[0]) || { headline: "Story 1", blurb: "", images: [] };
    const s2 = (page.stories && page.stories[1]) || { headline: "Story 2", blurb: "", images: [] };
    content.innerHTML = `
      <div style="display: flex; gap: 20px; height: 100%;">
        <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
          <h2 class="story-headline ${s1.headline.includes('Story') ? 'placeholder-text' : ''}" contenteditable="${!page.isLocked}" onblur="updateStoryHeadline(${pIdx}, 0, this.innerText)">${s1.headline}</h2>
          <div class="story-blurb" contenteditable="${!page.isLocked}" onblur="updateStoryBlurb(${pIdx}, 0, this.innerText)">${s1.blurb}</div>
          <button class="btn-trim-ai" onclick="triggerAiTrim(this)" title="AI-condense overflowing text" style="font-size: 10px; padding: 2px 8px; background: #334155; color: #a78bfa; border: 1px solid #6366f1; border-radius: 4px; cursor: pointer; margin-top: 4px;">✂️ AI Trim</button>
          <div class="image-placeholder-box ${!s1.images[0] ? 'empty' : ''}" style="flex: 1; min-height: 260px;" 
               onclick="triggerSlotUpload(${pIdx}, 0, 0)"
               ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, 0, 0)">
            <img src="${s1.images[0] || 'assets/sample4.jpg'}" alt="Story 1 Photo">
            <div class="image-actions-overlay">
              <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, 0, 0)">📁 Upload</button>
              <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, 0, 0)">✂️ Crop</button>
            </div>
          </div>
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 10px;">
          <h2 class="story-headline ${s2.headline.includes('Story') ? 'placeholder-text' : ''}" contenteditable="${!page.isLocked}" onblur="updateStoryHeadline(${pIdx}, 1, this.innerText)">${s2.headline}</h2>
          <div class="story-blurb" contenteditable="${!page.isLocked}" onblur="updateStoryBlurb(${pIdx}, 1, this.innerText)">${s2.blurb}</div>
          <button class="btn-trim-ai" onclick="triggerAiTrim(this)" title="AI-condense overflowing text" style="font-size: 10px; padding: 2px 8px; background: #334155; color: #a78bfa; border: 1px solid #6366f1; border-radius: 4px; cursor: pointer; margin-top: 4px;">✂️ AI Trim</button>
          <div class="image-placeholder-box ${!s2.images[0] ? 'empty' : ''}" style="flex: 1; min-height: 260px;" 
               onclick="triggerSlotUpload(${pIdx}, 1, 0)"
               ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, 1, 0)">
            <img src="${s2.images[0] || 'assets/sample6.jpg'}" alt="Story 2 Photo">
            <div class="image-actions-overlay">
              <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, 1, 0)">📁 Upload</button>
              <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, 1, 0)">✂️ Crop</button>
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    // Standard 3-story layout
    const stories = page.stories || [];
    stories.slice(0, 3).forEach((story, sIdx) => {
      const card = document.createElement("div");
      card.className = "story-row-card";
      card.innerHTML = `
        <div class="story-text-col">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <h2 class="story-headline ${story.headline.includes('Enter') ? 'placeholder-text' : ''}" contenteditable="${!page.isLocked}" onblur="updateStoryHeadline(${pIdx}, ${sIdx}, this.innerText)">${story.headline}</h2>
            <div style="display: flex; gap: 2px;">
              <button class="btn-tiny" onclick="adjustStoryFontSize(${pIdx}, ${sIdx}, 1)">+</button>
              <button class="btn-tiny" onclick="adjustStoryFontSize(${pIdx}, ${sIdx}, -1)">-</button>
            </div>
          </div>
          <div class="story-blurb" contenteditable="${!page.isLocked}" onblur="updateStoryBlurb(${pIdx}, ${sIdx}, this.innerText)">${story.blurb}</div>
          <button class="btn-trim-ai" onclick="triggerAiTrim(this)" title="AI-condense overflowing text" style="font-size: 10px; padding: 2px 8px; background: #334155; color: #a78bfa; border: 1px solid #6366f1; border-radius: 4px; cursor: pointer; margin-top: 4px;">✂️ AI Trim</button>
        </div>
        <div class="story-image-col">
          <div class="image-placeholder-box ${!story.images[0] ? 'empty' : ''}" 
               onclick="triggerSlotUpload(${pIdx}, ${sIdx}, 0)"
               ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, ${sIdx}, 0)">
            <img src="${story.images[0] || 'assets/sample1.jpg'}" alt="Story Photo">
            <div class="image-actions-overlay">
              <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, ${sIdx}, 0)">📁 Upload</button>
              <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, ${sIdx}, 0)">✂️ Crop</button>
            </div>
          </div>
        </div>
      `;
      content.appendChild(card);
    });
  }

  pageEl.appendChild(content);
}

function updateStoryHeadline(pIdx, sIdx, val) {
  if (bulletin.pages[pIdx].stories && bulletin.pages[pIdx].stories[sIdx]) {
    bulletin.pages[pIdx].stories[sIdx].headline = val.trim();
  }
}

function updateStoryBlurb(pIdx, sIdx, val) {
  if (bulletin.pages[pIdx].stories && bulletin.pages[pIdx].stories[sIdx]) {
    bulletin.pages[pIdx].stories[sIdx].blurb = val.trim();
  }
}

function adjustStoryFontSize(pIdx, sIdx, delta) {
  const card = document.querySelector(`#page-card-${pIdx} .story-row-card:nth-child(${sIdx + 1}) .story-headline`);
  if (card) {
    const curSize = parseInt(window.getComputedStyle(card).fontSize, 10);
    card.style.fontSize = (curSize + delta) + "px";
  }
}

// 5. Spotlight 6-Grid Page
function renderSpotlightPage(pageEl, page, pIdx) {
  pageEl.appendChild(createSectionBanner(page, pIdx));
  const content = document.createElement("div");
  content.className = "page-content-area";

  let gridHtml = "";
  const imgs = page.images || [];
  for (let i = 0; i < 6; i++) {
    gridHtml += `
      <div class="image-placeholder-box ${!imgs[i] ? 'empty' : ''}" style="height: 100%; min-height: 160px;" 
           onclick="triggerSlotUpload(${pIdx}, 0, ${i}, false, true)"
           ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleSlotFileDrop(event, ${pIdx}, 0, ${i}, false, true)">
        <img src="${imgs[i] || 'assets/sample1.jpg'}" alt="Spotlight ${i + 1}">
        <div class="image-actions-overlay">
          <button class="btn-upload-direct" onclick="event.stopPropagation(); triggerSlotUpload(${pIdx}, 0, ${i}, false, true)">📁 Upload</button>
          <button onclick="event.stopPropagation(); openCropperForTarget(${pIdx}, 0, ${i}, false, true)">✂️ Crop</button>
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 12px; height: 100%;">
      ${gridHtml}
    </div>
  `;
  pageEl.appendChild(content);
}

// 6. Visit Us Back Cover Page
function renderVisitUsPage(pageEl, page, pIdx) {
  const content = document.createElement("div");
  content.className = "visit-us-page";
  content.innerHTML = `
    <h2 class="visit-heading">${bulletin.language === 'hi' ? 'हमसे जुड़ें' : 'VISIT US'}</h2>
    <div class="social-columns-grid">
      <div class="social-col">
        <div class="social-col-title">For more information on<br><strong>Swachh Bharat Mission – Urban</strong></div>
        <div class="social-row"><span class="social-icon-circle icon-fb">f</span> Swachh Bharat Mission – Urban</div>
        <div class="social-row"><span class="social-icon-circle icon-x">𝕏</span> @SwachhBharatGov</div>
        <div class="social-row"><span class="social-icon-circle icon-insta">📸</span> sbm_urban</div>
        <div class="social-row"><span class="social-icon-circle icon-yt">▶</span> Swachh Bharat Urban</div>
        <div class="social-row"><span class="social-icon-circle icon-li">in</span> swachh-bharat-urban</div>
      </div>
      <div class="social-col">
        <div class="social-col-title">For more information on<br><strong>Swachh Bharat Mission (Grameen)</strong></div>
        <div class="social-row"><span class="social-icon-circle icon-fb">f</span> Swachh Bharat Mission, India</div>
        <div class="social-row"><span class="social-icon-circle icon-x">𝕏</span> @swachhbharat</div>
        <div class="social-row"><span class="social-icon-circle icon-insta">📸</span> @swachhbharatgrameen</div>
        <div class="social-row"><span class="social-icon-circle icon-yt">▶</span> @SwachhBharatMissionGramin</div>
        <div class="social-row"><span class="social-icon-circle icon-li">in</span> @swachhbharatmissiongrameen</div>
      </div>
    </div>
  `;
  pageEl.appendChild(content);
}

// Helper: Parse Date String
function parseDateString(str) {
  if (!str) return { day: "20th", rest: "September, 2026" };
  const parts = str.split(" ");
  if (parts.length >= 2) {
    return { day: parts[0], rest: parts.slice(1).join(" ") };
  }
  return { day: str, rest: "" };
}

// ==================== IMAGE UPLOADER & DRAG-AND-DROP ====================

// Triggers native file selector for a page slot
function triggerSlotUpload(pIdx, sIdx, imgIdx, isCover = false, isSpotlight = false) {
  currentCropTarget = { pIdx, sIdx, imgIdx, isCover, isSpotlight, isCtu: false };
  const input = document.getElementById("slotImageUploader");
  input.value = "";
  input.click();
}

// Triggers native file selector for a Before/After CTU slot
function triggerCtuUpload(pIdx, pairIdx, type) {
  currentCropTarget = { pIdx, pairIdx, type, isCtu: true };
  const input = document.getElementById("slotImageUploader");
  input.value = "";
  input.click();
}

// Browse file from inside the crop modal
function browseFileForCropper() {
  const input = document.getElementById("slotImageUploader");
  input.value = "";
  input.click();
}

// Handles file selected from computer
async function handleSlotImageUploaded(e) {
  const file = e.target.files[0];
  if (!file || !currentCropTarget) return;

  const compressed = await compressImage(file);
  await applyImageToTarget(currentCropTarget, compressed);
  showCropperModal(compressed);
}

// Applies an image (dataURL or ref) to target slot in state
async function applyImageToTarget(target, fileOrDataUrl) {
  pushState();
  const compressed = await compressImage(fileOrDataUrl);
  const imgRef = await storeImage(compressed);
  const { pIdx, sIdx, imgIdx, isCover, isSpotlight, isCtu, pairIdx, type } = target;

  if (isCtu) {
    if (!bulletin.pages[pIdx].ctuPairs) bulletin.pages[pIdx].ctuPairs = [];
    if (!bulletin.pages[pIdx].ctuPairs[pairIdx]) bulletin.pages[pIdx].ctuPairs[pairIdx] = {};
    if (type === 'before') {
      bulletin.pages[pIdx].ctuPairs[pairIdx].beforeImg = imgRef;
    } else {
      bulletin.pages[pIdx].ctuPairs[pairIdx].afterImg = imgRef;
    }
  } else if (isCover || isSpotlight) {
    if (!bulletin.pages[pIdx].images) bulletin.pages[pIdx].images = [];
    bulletin.pages[pIdx].images[imgIdx] = imgRef;
  } else {
    if (!bulletin.pages[pIdx].stories) bulletin.pages[pIdx].stories = [];
    if (!bulletin.pages[pIdx].stories[sIdx]) bulletin.pages[pIdx].stories[sIdx] = { images: [] };
    if (!bulletin.pages[pIdx].stories[sIdx].images) bulletin.pages[pIdx].stories[sIdx].images = [];
    bulletin.pages[pIdx].stories[sIdx].images[imgIdx] = imgRef;
  }

  renderCanvas();
  showToast("Image optimized and placed!", "success");
}

// Drag & Drop handlers for image slots
function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add("drag-over");
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove("drag-over");
}

async function handleSlotFileDrop(e, pIdx, sIdx, imgIdx, isCover = false, isSpotlight = false) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove("drag-over");

  const files = e.dataTransfer.files;
  if (!files || files.length === 0) {
    showToast("Please drop an image file here.", "warn");
    return;
  }
  const file = files[0];
  if (!file.type || !file.type.startsWith("image/")) {
    showToast("Only image files (.jpg, .png, .webp) are supported.", "warn");
    return;
  }

  currentCropTarget = { pIdx, sIdx, imgIdx, isCover, isSpotlight, isCtu: false };
  await applyImageToTarget(currentCropTarget, file);
}

async function handleCtuFileDrop(e, pIdx, pairIdx, type) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove("drag-over");

  const files = e.dataTransfer.files;
  if (!files || files.length === 0) {
    showToast("Please drop an image file here.", "warn");
    return;
  }
  const file = files[0];
  if (!file.type || !file.type.startsWith("image/")) {
    showToast("Only image files (.jpg, .png, .webp) are supported.", "warn");
    return;
  }

  currentCropTarget = { pIdx, pairIdx, type, isCtu: true };
  await applyImageToTarget(currentCropTarget, file);
}

// ==================== CROPPER & FOCAL ADJUSTER ====================
function openCropperForTarget(pIdx, sIdx, imgIdx, isCover = false, isSpotlight = false) {
  currentCropTarget = { pIdx, sIdx, imgIdx, isCover, isSpotlight, isCtu: false };
  let src = "";
  if (isCover) {
    src = bulletin.pages[pIdx].images[imgIdx] || "assets/sample1.jpg";
  } else if (isSpotlight) {
    src = bulletin.pages[pIdx].images[imgIdx] || "assets/sample1.jpg";
  } else {
    src = (bulletin.pages[pIdx].stories[sIdx].images && bulletin.pages[pIdx].stories[sIdx].images[imgIdx]) || "assets/sample1.jpg";
  }
  showCropperModal(getImageSync(src));
}

function openCropperForCtu(pIdx, pairIdx, type) {
  currentCropTarget = { pIdx, pairIdx, type, isCtu: true };
  const pair = bulletin.pages[pIdx].ctuPairs[pairIdx];
  const src = type === 'before' ? pair.beforeImg : pair.afterImg;
  showCropperModal(getImageSync(src) || "assets/sample10.jpg");
}

function showCropperModal(imageSrc) {
  const modal = document.getElementById("cropModal");
  const targetImg = document.getElementById("cropperTargetImg");

  targetImg.src = imageSrc;
  modal.classList.add("open");

  if (currentCropper) {
    currentCropper.destroy();
  }

  if (typeof Cropper !== "undefined") {
    currentCropper = new Cropper(targetImg, {
      aspectRatio: 16 / 9,
      viewMode: 1,
      autoCropArea: 0.95,
      responsive: true
    });
  }
}

function setCropAspect(aspect) {
  if (currentCropper) currentCropper.setAspectRatio(aspect);
}

function rotateCropper(deg) {
  if (currentCropper) currentCropper.rotate(deg);
}

function resetCropper() {
  if (currentCropper) currentCropper.reset();
}

function closeCropModal() {
  document.getElementById("cropModal").classList.remove("open");
  if (currentCropper) {
    currentCropper.destroy();
    currentCropper = null;
  }
}

async function applyCropResult() {
  if (!currentCropper || !currentCropTarget) {
    closeCropModal();
    return;
  }

  const canvas = currentCropper.getCroppedCanvas({
    maxWidth: 1200,
    maxHeight: 1200,
    fillColor: '#fff',
    imageSmoothingQuality: 'high'
  });

  if (canvas) {
    const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.82);
    await applyImageToTarget(currentCropTarget, croppedDataUrl);
  }
  closeCropModal();
}

// ==================== SEGMENT POOL & PHOTO DRAWER ====================
function toggleDrawer(forceOpen) {
  const drawer = document.getElementById("segmentDrawer");
  const toggleBtn = document.getElementById("btnToggleDrawer");
  if (typeof forceOpen === "boolean") {
    isDrawerOpen = forceOpen;
  } else {
    isDrawerOpen = !isDrawerOpen;
  }
  if (isDrawerOpen) {
    drawer.classList.remove("collapsed");
    if (toggleBtn) toggleBtn.style.display = "none";
  } else {
    drawer.classList.add("collapsed");
    if (toggleBtn) toggleBtn.style.display = "flex";
  }
}

function updateDrawerBadges() {
  const segBadge = document.getElementById("segCountBadge");
  const photoBadge = document.getElementById("photoCountBadge");
  if (segBadge) {
    segBadge.innerText = (bulletin.segments && Array.isArray(bulletin.segments)) ? bulletin.segments.length : 0;
  }
  if (photoBadge) {
    photoBadge.innerText = (bulletin.photoPool && Array.isArray(bulletin.photoPool)) ? bulletin.photoPool.length : 0;
  }
}

function renderSegmentDrawer() {
  const activeTabBtn = document.querySelector(".drawer-tab-btn.active");
  const tab = activeTabBtn ? activeTabBtn.getAttribute("data-tab") : "segments";
  renderDrawerTab(tab);
}

function renderDrawerTab(tab) {
  const content = document.getElementById("drawerTabContent");
  content.innerHTML = "";

  if (tab === "segments") {
    renderSegmentsTab(content);
  } else if (tab === "photos") {
    renderPhotoPoolTab(content);
  } else if (tab === "favorites") {
    renderFavoritesTab(content);
  }

  updateDrawerBadges();
}

function renderSegmentsTab(container) {
  // If segments is empty, initialize defaults so user immediately has stories
  if (!bulletin.segments || bulletin.segments.length === 0) {
    bulletin.segments = JSON.parse(JSON.stringify(DEFAULT_SEGMENTS_POOL));
  }

  const readyCount = bulletin.segments.filter(s => !s.status || s.status === "Ready" || s.status === "Draft").length;
  const placedCount = bulletin.segments.length - readyCount;

  const topBar = document.createElement("div");
  topBar.className = "drawer-controls-box";
  topBar.innerHTML = `
    <div style="display: flex; gap: 5px;">
      <button class="btn btn-primary" onclick="addNewSegment()" style="flex: 1; font-size: 11px; justify-content: center;">+ New</button>
      <button class="btn btn-ai" onclick="openBulkIngestModal()" style="flex: 1.2; font-size: 11px; justify-content: center;" title="Paste WhatsApp forwards or field notes">📥 Ingest</button>
      <button class="btn btn-export" onclick="autoDistributeSegments(3)" title="Distribute ready segments into pages" style="flex: 1.2; font-size: 11px; justify-content: center;">⚡ Auto-Pack</button>
    </div>
    <div class="pack-pill-group">
      <button class="pack-pill-btn" onclick="autoDistributeSegments(1)" title="Pack 1 story per Hero page">1-Hero</button>
      <button class="pack-pill-btn" onclick="autoDistributeSegments(2)" title="Pack 2 stories per Split page">2-Split</button>
      <button class="pack-pill-btn" onclick="autoDistributeSegments(3)" title="Pack 3 stories per Standard page">3-Standard</button>
    </div>
    <div class="drawer-status-bar">
      <span style="color: #cbd5e1;">Pool: <strong>${bulletin.segments.length}</strong> (<span style="color:#10b981;">${readyCount} Ready</span>, <span style="color:#38bdf8;">${placedCount} Placed</span>)</span>
      <div style="display: flex; gap: 4px;">
        <button class="btn-tiny" onclick="resetAllSegmentsReady()" title="Mark all segments as Ready for distribution">↺ Reset</button>
        <button class="btn-tiny" onclick="importStoriesFromPagesToSegments()" title="Import stories from current bulletin pages">📥 Import</button>
      </div>
    </div>
  `;
  container.appendChild(topBar);

  bulletin.segments.forEach((seg, sIdx) => {
    const card = document.createElement("div");
    card.className = "segment-card";

    let photosHtml = "";
    if (seg.photos && seg.photos.length > 0) {
      seg.photos.forEach((imgUrl, pImgIdx) => {
        photosHtml += `
          <div class="segment-photo-thumb-wrap">
            <img src="${getImageSync(imgUrl)}" class="segment-photo-thumb" alt="Segment Photo">
            <button class="btn-photo-del" onclick="event.stopPropagation(); deleteSegmentPhoto(${sIdx}, ${pImgIdx})" title="Remove photo">✕</button>
          </div>
        `;
      });
    }

    const isReady = !seg.status || seg.status === "Ready";
    const isPlaced = seg.status && seg.status.startsWith("Placed");
    
    let statusBadge = `<span class="segment-badge" style="background:#16a34a; color:white; cursor:pointer;" onclick="toggleSegmentStatus(${sIdx})" title="Click to toggle status">🟢 Ready</span>`;
    if (isPlaced) {
      statusBadge = `<span class="segment-badge" style="background:#0284c7; color:white; cursor:pointer;" onclick="unassignSegment(${sIdx})" title="Click to unassign and mark Ready">🔵 ${seg.status}</span>`;
    } else if (seg.status === "Draft") {
      statusBadge = `<span class="segment-badge" style="background:#64748b; color:white; cursor:pointer;" onclick="toggleSegmentStatus(${sIdx})" title="Click to mark Ready">⚪ Draft</span>`;
    }

    card.innerHTML = `
      <div class="segment-card-header">
        <div style="display: flex; align-items: center; gap: 5px;">
          <span class="segment-badge">${escapeHtml(seg.category || 'General')}</span>
          ${statusBadge}
        </div>
        <button class="btn-tiny" onclick="toggleSegmentFavorite(${sIdx})" title="Toggle favorite">${seg.isFavorite ? '⭐' : '☆'}</button>
      </div>
      <textarea class="segment-title-input" rows="2" placeholder="Headline / Title..." onblur="bulletin.segments[${sIdx}].title = this.value">${escapeHtml(seg.title || '')}</textarea>
      <div class="segment-preview-text">${escapeHtml(seg.blurb || 'No write-up yet...')}</div>
      <div class="segment-photos-strip">
        ${photosHtml}
        <button class="btn-add-seg-photo" onclick="addPhotoToSegment(${sIdx})" title="Add photo to segment">+ Photo</button>
      </div>
      <div class="segment-actions">
        <select class="segment-assign-select" onchange="assignSegmentToPage(${sIdx}, this.value)">
          <option value="">Place or Assign to...</option>
          <option value="new-1">+ New 1-Story Hero Page</option>
          <option value="new-2">+ New 2-Story Split Page</option>
          <option value="new-3">+ New 3-Story Standard Page</option>
          <optgroup label="Existing Pages">
            ${bulletin.pages.map((p, pIdx) => `<option value="${pIdx}">Page ${pIdx + 1} (${escapeHtml(p.sectionTitle || '')})</option>`).join("")}
          </optgroup>
        </select>
        <button class="btn-tiny delete" onclick="deleteSegment(${sIdx})" title="Delete segment">🗑️</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function openBulkIngestModal() {
  document.getElementById("bulkIngestModal").classList.add("open");
}

function addNewSegment() {
  pushState();
  if (!bulletin.segments) bulletin.segments = [];
  bulletin.segments.unshift({
    id: "seg-" + Date.now(),
    title: "New Field Story Segment",
    category: "State & ULB",
    location: "City / Ward",
    blurb: "Write-up summary of work accomplished on the ground...",
    photos: ["assets/sample1.jpg"],
    status: "Ready",
    isFavorite: false
  });
  renderSegmentDrawer();
}

function addPhotoToSegment(sIdx) {
  currentSegmentUploadIdx = sIdx;
  const input = document.getElementById("segmentPhotoUploader");
  input.value = "";
  input.click();
}

async function handleSegmentPhotoUploaded(e) {
  const files = Array.from(e.target.files);
  if (!files || files.length === 0 || currentSegmentUploadIdx === null) return;
  const seg = bulletin.segments[currentSegmentUploadIdx];
  if (!seg) return;
  if (!seg.photos) seg.photos = [];

  for (const file of files) {
    if (file.type && file.type.startsWith("image/")) {
      const compressed = await compressImage(file);
      const imgRef = await storeImage(compressed);
      seg.photos.push(imgRef);
    }
  }
  currentSegmentUploadIdx = null;
  pushState();
  renderSegmentDrawer();
  showToast("Photo added to story segment!", "success");
}

function deleteSegmentPhoto(sIdx, pImgIdx) {
  pushState();
  if (bulletin.segments[sIdx] && bulletin.segments[sIdx].photos) {
    bulletin.segments[sIdx].photos.splice(pImgIdx, 1);
    renderSegmentDrawer();
    showToast("Photo removed from segment", "info");
  }
}

function deleteSegment(sIdx) {
  pushState();
  bulletin.segments.splice(sIdx, 1);
  renderSegmentDrawer();
  showToast("Story segment deleted", "info");
}

function toggleSegmentFavorite(sIdx) {
  bulletin.segments[sIdx].isFavorite = !bulletin.segments[sIdx].isFavorite;
  renderSegmentDrawer();
}

function toggleSegmentStatus(sIdx) {
  pushState();
  const seg = bulletin.segments[sIdx];
  if (seg.status === "Ready" || !seg.status) {
    seg.status = "Draft";
  } else {
    seg.status = "Ready";
  }
  renderSegmentDrawer();
}

function unassignSegment(sIdx) {
  pushState();
  bulletin.segments[sIdx].status = "Ready";
  renderSegmentDrawer();
}

function resetAllSegmentsReady() {
  pushState();
  bulletin.segments.forEach(s => s.status = "Ready");
  renderSegmentDrawer();
  showToast(`All ${bulletin.segments.length} segments marked Ready!`, "success");
}

// Extract stories from existing bulletin pages into Segment Pool
function importStoriesFromPagesToSegments() {
  let importedCount = 0;
  pushState();
  if (!bulletin.segments) bulletin.segments = [];

  bulletin.pages.forEach((page, pIdx) => {
    if (page.stories && page.stories.length > 0) {
      page.stories.forEach(story => {
        if (story.headline && !story.headline.includes("Enter")) {
          // Avoid exact duplicate
          const exists = bulletin.segments.some(s => s.title.toLowerCase() === story.headline.toLowerCase());
          if (!exists) {
            bulletin.segments.push({
              id: "seg-" + Date.now() + "-" + Math.random(),
              title: story.headline,
              category: page.sectionTitle.includes("Top") ? "Top Stories" : (page.sectionTitle.includes("Citizen") ? "Citizen Participation" : "State & ULB"),
              location: "Ground Location",
              blurb: story.blurb || "",
              photos: story.images && story.images.length > 0 ? story.images : ["assets/sample1.jpg"],
              status: "Ready",
              isFavorite: false
            });
            importedCount++;
          }
        }
      });
    }
  });

  renderSegmentDrawer();
  showToast(`Imported ${importedCount} stories into the Story Pool!`, "success");
}

function assignSegmentToPage(segIdx, targetVal) {
  if (!targetVal) return;
  const seg = bulletin.segments[segIdx];
  pushState();

  if (targetVal === "new-1") {
    // Create new Single-Segment Hero Page
    const newPage = {
      id: "p-" + Date.now(),
      type: "hero-1-story",
      theme: (seg.category || '').includes("Top") ? "theme-orange" : ((seg.category || '').includes("Citizen") ? "theme-coral" : "theme-blue"),
      sectionTitle: (seg.category || '').includes("Top") ? "Top Stories of the Day" : ((seg.category || '').includes("Citizen") ? "Citizen Participation" : "State & ULB Initiatives"),
      stories: [{
        headline: seg.title,
        blurb: seg.blurb,
        images: seg.photos && seg.photos.length > 0 ? seg.photos : ["assets/sample3.jpg", "assets/sample1.jpg"]
      }]
    };
    bulletin.pages.push(newPage);
    seg.status = "Placed on Page " + bulletin.pages.length;
    renderAll();
    scrollToPage(bulletin.pages.length - 1);
    showToast(`Created Hero Page (Page ${bulletin.pages.length}) with this segment!`, "success");
    return;
  }

  if (targetVal === "new-2") {
    // Create new Double-Segment Split Page
    const newPage = {
      id: "p-" + Date.now(),
      type: "split-2-story",
      theme: (seg.category || '').includes("Top") ? "theme-orange" : "theme-blue",
      sectionTitle: (seg.category || '').includes("Top") ? "Top Stories of the Day" : "State & ULB Initiatives",
      stories: [
        { headline: seg.title, blurb: seg.blurb, images: seg.photos && seg.photos.length > 0 ? seg.photos : ["assets/sample4.jpg"] },
        { headline: "Enter Second Story Headline", blurb: "Enter description for second story...", images: ["assets/sample6.jpg"] }
      ]
    };
    bulletin.pages.push(newPage);
    seg.status = "Placed on Page " + bulletin.pages.length;
    renderAll();
    scrollToPage(bulletin.pages.length - 1);
    showToast(`Created Double-Story Split Page (Page ${bulletin.pages.length})!`, "success");
    return;
  }

  if (targetVal === "new-3") {
    // Create new 3-Story Standard Page
    const newPage = {
      id: "p-" + Date.now(),
      type: "standard-3-story",
      theme: (seg.category || '').includes("Citizen") ? "theme-coral" : "theme-blue",
      sectionTitle: (seg.category || '').includes("Citizen") ? "Citizen Participation" : "State & ULB Initiatives",
      stories: [
        { headline: seg.title, blurb: seg.blurb, images: seg.photos && seg.photos.length > 0 ? seg.photos : ["assets/sample1.jpg"] },
        { headline: "Enter Story Headline Here", blurb: "Enter 3-4 sentence official description...", images: ["assets/sample3.jpg"] },
        { headline: "Community Mobilization Drive", blurb: "Citizens and local authorities join hands...", images: ["assets/sample4.jpg"] }
      ]
    };
    bulletin.pages.push(newPage);
    seg.status = "Placed on Page " + bulletin.pages.length;
    renderAll();
    scrollToPage(bulletin.pages.length - 1);
    showToast(`Created 3-Story Page (Page ${bulletin.pages.length})!`, "success");
    return;
  }

  // Assign to existing page
  const pageIdx = parseInt(targetVal, 10);
  const targetPage = bulletin.pages[pageIdx];

  if (!targetPage) return;

  if (!targetPage.stories) targetPage.stories = [];
  targetPage.stories.push({
    headline: seg.title,
    blurb: seg.blurb,
    images: seg.photos && seg.photos.length > 0 ? seg.photos : ["assets/sample1.jpg"]
  });

  seg.status = "Placed on Page " + (pageIdx + 1);
  renderAll();
  scrollToPage(pageIdx);
  showToast(`Segment placed onto Page ${pageIdx + 1}!`, "success");
}

function autoDistributeSegments(densityChoice) {
  // 1. If segment pool is empty, immediately populate with default pool
  if (!bulletin.segments || bulletin.segments.length === 0) {
    bulletin.segments = JSON.parse(JSON.stringify(DEFAULT_SEGMENTS_POOL));
    renderSegmentDrawer();
  }

  // 2. Check candidates; if all are already Placed, auto-reset to Ready
  let candidates = bulletin.segments.filter(s => !s.status || s.status === "Ready" || s.status === "Draft");

  if (candidates.length === 0) {
    bulletin.segments.forEach(s => s.status = "Ready");
    candidates = bulletin.segments;
  }

  // 3. Density: Default to 3 (Standard layout), or 1 (Hero) or 2 (Split) if specified
  let density = parseInt(densityChoice, 10);
  if (isNaN(density) || density < 1 || density > 3) {
    density = 3; // Default to standard 3-story layout
  }

  pushState();

  const chunkSize = density;
  let newPagesCount = 0;
  const initialPageCount = bulletin.pages.length;

  for (let i = 0; i < candidates.length; i += chunkSize) {
    const chunk = candidates.slice(i, i + chunkSize);
    
    // Choose theme based on category of first story in chunk
    let theme = "theme-blue";
    let sectionTitle = "State & ULB Initiatives";
    const cat = chunk[0].category || "";
    if (cat.includes("Top")) {
      theme = "theme-orange";
      sectionTitle = "Top Stories of the Day";
    } else if (cat.includes("Citizen") || cat.includes("Jan Bhagidari")) {
      theme = "theme-coral";
      sectionTitle = "Citizen Participation";
    }

    let pageType = "standard-3-story";
    if (density === 1) {
      pageType = "hero-1-story";
    } else if (density === 2) {
      pageType = "split-2-story";
    }

    const targetPageNum = initialPageCount + newPagesCount + 1;

    const newPage = {
      id: "p-" + Date.now() + "-" + i,
      type: pageType,
      theme: theme,
      sectionTitle: sectionTitle,
      stories: chunk.map(seg => ({
        headline: seg.title,
        blurb: seg.blurb,
        images: seg.photos && seg.photos.length > 0 ? seg.photos : ["assets/sample1.jpg"]
      }))
    };

    bulletin.pages.push(newPage);
    chunk.forEach(s => s.status = "Placed on Page " + targetPageNum);
    newPagesCount++;
  }

  renderAll();
  scrollToPage(bulletin.pages.length - 1);
  showToast(`Distributed ${candidates.length} stories into ${newPagesCount} new page(s)!`, "success");
}

// Bulk Photo Pool Tab
function renderPhotoPoolTab(container) {
  container.innerHTML = `
    <div class="bulk-drop-zone" onclick="document.getElementById('bulkPhotoInput').click()"
         ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleBulkPhotoDrop(event)">
      <div style="font-size: 24px;">📁</div>
      <div style="font-size: 13px; font-weight: 700; color: #f8fafc; margin-top: 4px;">Click or Drag Photos Here</div>
      <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Bulk upload 15–20 field photos at once</div>
    </div>
    <div class="photo-pool-grid" id="photoPoolGrid"></div>
  `;

  const grid = document.getElementById("photoPoolGrid");
  if (bulletin.photoPool && bulletin.photoPool.length > 0) {
    bulletin.photoPool.forEach((item, idx) => {
      const el = document.createElement("div");
      el.className = "photo-pool-item";

      let badgeHtml = "";
      if (item.width && item.width < 300) {
        badgeHtml = `<span class="quality-badge quality-danger" title="Too small for print (<300px)">⚠️ Low</span>`;
      } else if (item.width && item.width < 600) {
        badgeHtml = `<span class="quality-badge quality-warning" title="Medium resolution">⚠️ Med</span>`;
      }

      el.innerHTML = `
        <img src="${getImageSync(item.url)}" alt="Pool Photo">
        ${badgeHtml}
        <button class="btn-photo-del" onclick="event.stopPropagation(); bulletin.photoPool.splice(${idx}, 1); renderSegmentDrawer();" title="Remove photo">✕</button>
      `;
      grid.appendChild(el);
    });
  }
}

function handleBulkPhotosUploaded(e) {
  const files = Array.from(e.target.files);
  processBulkPhotoFiles(files);
}

function handleBulkPhotoDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove("drag-over");
  const files = Array.from(e.dataTransfer.files).filter(f => f.type && f.type.startsWith("image/"));
  if (files.length === 0) {
    showToast("Please drop valid image files.", "warn");
    return;
  }
  processBulkPhotoFiles(files);
}

async function processBulkPhotoFiles(files) {
  if (!bulletin.photoPool) bulletin.photoPool = [];

  let loadedCount = 0;
  for (const file of files) {
    try {
      const compressed = await compressImage(file);
      const imgRef = await storeImage(compressed);
      bulletin.photoPool.push({
        id: "photo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        url: imgRef,
        name: file.name,
        width: 1200,
        height: 800
      });
      loadedCount++;
    } catch (err) {
      console.warn("Bulk photo error:", err);
    }
  }

  if (loadedCount > 0) {
    pushState();
    renderSegmentDrawer();
    showToast(`Added ${loadedCount} optimized photos to the pool!`, "success");
  }
}

function renderFavoritesTab(container) {
  const favs = bulletin.segments ? bulletin.segments.filter(s => s.isFavorite) : [];
  if (favs.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: #94a3b8; padding: 30px 10px; font-size: 12px;">
        No starred favorites yet.<br>Click the ⭐ star icon on any segment to save it here for fast reuse across daily editions.
      </div>
    `;
    return;
  }

  favs.forEach(seg => {
    const card = document.createElement("div");
    card.className = "segment-card";
    card.innerHTML = `
      <div style="font-size: 13px; font-weight: 700; color: white;">⭐ ${seg.title}</div>
      <div class="segment-preview-text">${seg.blurb}</div>
      <button class="btn btn-secondary" onclick="insertFavoriteSegment('${seg.id}')" style="margin-top: 6px; font-size: 11px;">Insert into Active Page</button>
    `;
    container.appendChild(card);
  });
}

function insertFavoriteSegment(segId) {
  const seg = bulletin.segments.find(s => s.id === segId);
  if (!seg) return;
  pushState();
  const page = bulletin.pages[activePageIndex];
  if (page.stories) {
    page.stories.push({ headline: seg.title, blurb: seg.blurb, images: seg.photos });
    renderCanvas();
    showToast(`Inserted "${seg.title}" into Page ${activePageIndex + 1}!`, "success");
  }
}

// ==================== WELCOME & TEMPLATES ====================
function openWelcomeModal() {
  document.getElementById("welcomeModal").classList.add("open");
  renderUserCustomTemplates();
}

function filterWelcomeTemplates(cat, btn) {
  if (btn) {
    document.querySelectorAll(".template-filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }
  applyTemplateFilters();
}

function applyTemplateFilters() {
  const activeBtn = document.querySelector(".template-filter-btn.active");
  const cat = activeBtn ? (activeBtn.getAttribute("data-category") || "all") : "all";
  const search = (document.getElementById("templateSearchInput")?.value || "").toLowerCase().trim();

  const cards = document.querySelectorAll("#officialTemplateGrid .template-card");
  cards.forEach(c => {
    const cardCat = (c.getAttribute("data-cat") || "").toLowerCase();
    const cardText = c.innerText.toLowerCase();

    const matchesCat = (cat === "all" || cardCat.includes(cat));
    const matchesSearch = !search || cardText.includes(search);

    if (matchesCat && matchesSearch) {
      c.style.display = "flex";
    } else {
      c.style.display = "none";
    }
  });
}

function loadTemplatePack(type) {
  pushState();
  if (type === "standard_17") {
    bulletin.pages = JSON.parse(JSON.stringify(STANDARD_17_PAGE_PACK));
    bulletin.campaignTitle = "Swachhata Hi Seva 2026";
    bulletin.language = "en";
    showToast("Loaded Swachhata 17-Page National Standard Template", "success");
  } else if (type === "executive_5") {
    bulletin.pages = JSON.parse(JSON.stringify(EXECUTIVE_5_PACK));
    bulletin.language = "en";
    showToast("Loaded Quick Daily Brief (Executive 5 Pages)", "success");
  } else if (type === "ctu_special") {
    bulletin.pages = JSON.parse(JSON.stringify(CTU_SPECIAL_PACK));
    bulletin.language = "en";
    showToast("Loaded CTU Transformation Special (Before & After)", "success");
  } else if (type === "green_earth") {
    bulletin.pages = JSON.parse(JSON.stringify(GREEN_EARTH_PACK));
    bulletin.language = "en";
    showToast("Loaded Green Earth & Circular Economy Special (6 Pages)", "success");
  } else if (type === "smart_city") {
    bulletin.pages = JSON.parse(JSON.stringify(SMART_CITY_PACK));
    bulletin.language = "en";
    showToast("Loaded Smart City & Municipal Operations (5 Pages)", "success");
  } else if (type === "jan_andolan") {
    bulletin.pages = JSON.parse(JSON.stringify(JAN_ANDOLAN_PACK));
    bulletin.language = "en";
    showToast("Loaded Jan Andolan: Youth & Citizen Action (6 Pages)", "success");
  } else if (type === "safaimitra") {
    bulletin.pages = JSON.parse(JSON.stringify(SAFAIMITRA_PACK));
    bulletin.language = "en";
    showToast("Loaded SafaiMitra Suraksha & Welfare Special (5 Pages)", "success");
  } else if (type === "jal_shakti") {
    bulletin.pages = JSON.parse(JSON.stringify(JAL_SHAKTI_PACK));
    bulletin.language = "en";
    showToast("Loaded Jal Shakti & Coastal Cleanliness Bulletin (5 Pages)", "success");
  } else if (type === "photojournalism") {
    bulletin.pages = JSON.parse(JSON.stringify(PHOTOJOURNALISM_PACK));
    bulletin.language = "en";
    showToast("Loaded Swachhata In Lens: Photojournalism (4 Pages)", "success");
  } else if (type === "hindi_standard") {
    bulletin.pages = JSON.parse(JSON.stringify(HINDI_STANDARD_PACK));
    bulletin.language = "hi";
    bulletin.globalDate = "20 सितम्बर, 2026";
    showToast("दैनिक स्वच्छता बुलेटिन (हिन्दी मानक) लोड किया गया", "success");
  } else if (type === "fast_flash") {
    bulletin.pages = JSON.parse(JSON.stringify(FAST_FLASH_PACK));
    bulletin.language = "en";
    showToast("Loaded Fast Field Flash (1-Page Urgent Dispatch)", "success");
  } else if (type === "blank") {
    bulletin.pages = [
      { id: "p-1", type: "cover", theme: "theme-teal", sectionTitle: "Cover Page", coverTitle: "Daily Bulletin", coverYear: "2026", coverBadge: "Bulletin", images: [] },
      { id: "p-2", type: "standard-3-story", theme: "theme-blue", sectionTitle: "State & ULB Initiatives", stories: [{ headline: "Enter Headline Here", blurb: "Enter writeup...", images: [] }] },
      { id: "p-3", type: "visit-us", theme: "theme-teal", sectionTitle: "Back Cover", visitText: "VISIT US" }
    ];
    bulletin.language = "en";
    showToast("Started Fresh Scratchpad", "info");
  }

  activePageIndex = 0;
  document.getElementById("welcomeModal").classList.remove("open");
  renderAll();
  scrollToPage(0);
}

function triggerCloneYesterday() {
  pushState();
  bulletin.pages.forEach(p => {
    if (p.stories) {
      p.stories.forEach(s => {
        s.headline = "Enter Headline Here";
        s.blurb = "Enter daily report description...";
        s.images = [];
      });
    }
    if (p.ctuPairs) {
      p.ctuPairs.forEach(pair => {
        pair.desc = "Enter transformation details...";
        pair.beforeImg = null;
        pair.afterImg = null;
      });
    }
  });

  document.getElementById("welcomeModal").classList.remove("open");
  renderAll();
  showToast("Cloned structure! Photos and story texts reset for today's new input.", "success");
}

function openSaveTemplateModal() {
  document.getElementById("saveTemplateModal").classList.add("open");
}

function confirmSaveCustomTemplate() {
  const name = document.getElementById("customTemplateName").value.trim();
  if (!name) {
    showToast("Please enter a template name.", "warn");
    return;
  }

  if (!bulletin.customTemplates) bulletin.customTemplates = [];

  const templateObj = {
    id: "tmpl-" + Date.now(),
    name: name,
    pages: JSON.parse(JSON.stringify(bulletin.pages))
  };

  bulletin.customTemplates.push(templateObj);
  localStorage.setItem("gov_bulletin_user_templates", JSON.stringify(bulletin.customTemplates));
  document.getElementById("saveTemplateModal").classList.remove("open");
  showToast(`Saved "${name}" as a reusable custom template!`, "success");
}

function renderUserCustomTemplates() {
  const section = document.getElementById("userCustomTemplatesSection");
  const grid = document.getElementById("customTemplatesGrid");
  grid.innerHTML = "";

  if (bulletin.customTemplates && bulletin.customTemplates.length > 0) {
    section.style.display = "block";
    bulletin.customTemplates.forEach(t => {
      const card = document.createElement("div");
      card.className = "template-card";
      card.onclick = () => {
        pushState();
        bulletin.pages = JSON.parse(JSON.stringify(t.pages));
        document.getElementById("welcomeModal").classList.remove("open");
        renderAll();
      };
      card.innerHTML = `
        <div style="font-size: 20px;">⭐</div>
        <div class="template-title">${t.name}</div>
        <div class="template-desc">${t.pages.length} pages structured template</div>
      `;
      grid.appendChild(card);
    });
  } else {
    section.style.display = "none";
  }
}

// ==================== PRE-FLIGHT REVIEW ====================
function toggleReviewMode() {
  isReviewMode = !isReviewMode;
  const btn = document.getElementById("btnToggleReview");
  if (isReviewMode) {
    document.body.classList.add("review-mode");
    btn.classList.add("active-review");
    runPreFlightCheck();
  } else {
    document.body.classList.remove("review-mode");
    btn.classList.remove("active-review");
  }
}

function runPreFlightCheck() {
  const issues = [];

  bulletin.pages.forEach((p, idx) => {
    if (p.stories) {
      p.stories.forEach((s, sIdx) => {
        if (!s.images || s.images.length === 0 || !s.images[0]) {
          issues.push({ page: idx + 1, type: "Empty Image", desc: `Story "${s.headline.slice(0, 25)}..." has no photo.` });
        }
        if (s.headline.includes("Enter") || s.headline.includes("Headline")) {
          issues.push({ page: idx + 1, type: "Placeholder Title", desc: `Default placeholder title still present.` });
        }
      });
    }
    if (p.ctuPairs) {
      p.ctuPairs.forEach((pair, pairIdx) => {
        if (!pair.beforeImg || !pair.afterImg) {
          issues.push({ page: idx + 1, type: "Missing CTU Photo", desc: `Pair #${pairIdx + 1} is missing Before or After photo.` });
        }
      });
    }
  });

  const modal = document.getElementById("reviewModal");
  const body = document.getElementById("reviewModalBody");

  if (issues.length === 0) {
    body.innerHTML = `
      <div style="text-align: center; color: #10b981; padding: 20px;">
        <div style="font-size: 32px;">✓</div>
        <h4 style="font-size: 16px; font-weight: 700; margin-top: 6px;">All Checks Passed!</h4>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Zero empty photo slots, zero placeholder headlines. Your bulletin is 100% ready to export!</p>
      </div>
    `;
  } else {
    let itemsHtml = "";
    issues.forEach(iss => {
      itemsHtml += `
        <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 8px 12px; border-radius: 6px; border-left: 3px solid #f59e0b;">
          <div>
            <strong style="color: #f59e0b; font-size: 12px;">Page ${iss.page}: ${iss.type}</strong>
            <div style="font-size: 11px; color: #cbd5e1;">${iss.desc}</div>
          </div>
          <button class="btn btn-secondary" style="font-size: 10px;" onclick="document.getElementById('reviewModal').classList.remove('open'); scrollToPage(${iss.page - 1});">Fix</button>
        </div>
      `;
    });

    body.innerHTML = `
      <p style="font-size: 12px; color: #f59e0b; font-weight: 600;">Found ${issues.length} item(s) to review before shipping:</p>
      <div style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto;">
        ${itemsHtml}
      </div>
    `;
  }

  modal.classList.add("open");
}

// ==================== DUAL PDF EXPORT & PAGE SELECTOR ====================
function openExportModal(defaultMode = "print") {
  const checklist = document.getElementById("exportPageChecklist");
  checklist.innerHTML = "";

  bulletin.pages.forEach((page, pIdx) => {
    let title = page.sectionTitle;
    if (page.type === "cover") title = "Cover: " + (page.coverTitle ? page.coverTitle.replace("\n", " ") : "Bulletin");
    const item = document.createElement("label");
    item.style.cssText = "display:flex; align-items:center; gap:8px; font-size:12px; color:#cbd5e1; cursor:pointer; padding:3px 0;";
    item.innerHTML = `
      <input type="checkbox" class="export-page-cb" data-pidx="${pIdx}" checked onchange="updateExportSelectedCount()">
      <span><strong>Page ${pIdx + 1}:</strong> ${title} (${page.type})</span>
    `;
    checklist.appendChild(item);
  });

  updateExportSelectedCount();
  document.getElementById("exportModal").classList.add("open");
}

function updateExportSelectedCount() {
  const total = bulletin.pages.length;
  const checked = document.querySelectorAll(".export-page-cb:checked").length;
  const countEl = document.getElementById("exportSelectedCount");
  if (countEl) {
    countEl.innerText = `${checked} of ${total} pages selected`;
  }
}

function toggleAllExportPages(checked) {
  document.querySelectorAll(".export-page-cb").forEach(cb => cb.checked = checked);
  updateExportSelectedCount();
}

function exportSelectedPages(mode) {
  const selectedCheckboxes = document.querySelectorAll(".export-page-cb:checked");
  if (selectedCheckboxes.length === 0) {
    showToast("Please select at least 1 page to export.", "warn");
    return;
  }

  const selectedIndices = Array.from(selectedCheckboxes).map(cb => parseInt(cb.getAttribute("data-pidx"), 10));

  // Hide unselected pages temporarily
  document.querySelectorAll(".a4-page").forEach((pageEl, pIdx) => {
    if (!selectedIndices.includes(pIdx)) {
      pageEl.style.display = "none";
    }
  });

  document.getElementById("exportModal").classList.remove("open");

  if (mode === "print") {
    document.body.classList.remove("review-mode");
    window.print();
    setTimeout(() => {
      document.querySelectorAll(".a4-page").forEach(el => el.style.display = "");
    }, 2000);
  } else if (mode === "whatsapp") {
    const element = document.getElementById("canvasViewport");
    showToast(`Generating ${selectedIndices.length}-page WhatsApp PDF...`, "info", 8000);

    const dateFormatted = (bulletin.globalDate || "Bulletin").replace(/[^a-zA-Z0-9]/g, "_");
    const opt = {
      margin: 0,
      filename: `Gov_Bulletin_WA_${dateFormatted}.pdf`,
      image: { type: "jpeg", quality: 0.55 },
      html2canvas: { scale: 1.0, useCORS: true, logging: false },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    };

    if (typeof html2pdf !== "undefined") {
      html2pdf().set(opt).from(element).save().then(() => {
        showToast("✅ WhatsApp PDF downloaded successfully (<5MB)!", "success");
        document.querySelectorAll(".a4-page").forEach(el => el.style.display = "");
      }).catch(err => {
        console.error("html2pdf failed:", err);
        showToast("PDF rendering failed. Falling back to print export.", "error");
        document.querySelectorAll(".a4-page").forEach(el => el.style.display = "");
        window.print();
      });
    } else {
      showToast("Preparing WhatsApp print output...", "info");
      window.print();
      setTimeout(() => {
        document.querySelectorAll(".a4-page").forEach(el => el.style.display = "");
      }, 2000);
    }
  }
}

function exportPrintPdf() {
  openExportModal("print");
}

function exportWhatsAppPdf() {
  openExportModal("whatsapp");
}

// ==================== SAVE / LOAD DRAFT ====================
function downloadDraftJson() {
  saveToLocalStorage();
  const imagesObj = {};
  imageCache.forEach((val, key) => {
    imagesObj[key] = val;
  });

  const exportBundle = {
    appVersion: "2.3",
    exportDate: new Date().toISOString(),
    bulletin: bulletin,
    images: imagesObj
  };

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportBundle, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", dataStr);
  const dateFormatted = bulletin.globalDate.replace(/[^a-zA-Z0-9]/g, "_");
  dlAnchorElem.setAttribute("download", `Gov_Bulletin_${dateFormatted}.json`);
  dlAnchorElem.click();
  showToast("Draft JSON exported with assets!", "success");
}

async function handleLoadDraftFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const loaded = JSON.parse(event.target.result);
      let targetBulletin = null;

      if (loaded.bulletin && loaded.bulletin.pages) {
        targetBulletin = loaded.bulletin;
        // Import packed images into imageCache & IndexedDB
        if (loaded.images) {
          for (const [id, dataUrl] of Object.entries(loaded.images)) {
            imageCache.set(id, dataUrl);
            try {
              const db = await openImageDB();
              const tx = db.transaction(IMG_STORE_NAME, "readwrite");
              tx.objectStore(IMG_STORE_NAME).put({ id, data: dataUrl, created: Date.now() });
            } catch (err) {}
          }
        }
      } else if (loaded.pages && Array.isArray(loaded.pages)) {
        targetBulletin = loaded;
      }

      if (targetBulletin) {
        pushState();
        bulletin = targetBulletin;
        await autoMigrateLegacyImages();
        document.getElementById("globalDateInput").value = bulletin.globalDate || "20th September, 2026";
        activePageIndex = 0;
        renderAll();
        document.getElementById("welcomeModal").classList.remove("open");
        showToast("Draft loaded successfully with all media!", "success");
      }
    } catch (err) {
      showToast("Failed to parse JSON file: " + err.message, "error");
    }
  };
  reader.readAsText(file);
}

// ==================== DYNAMIC HEADER LOGOS BUILDER ====================
function buildHeaderLogosHtml(page) {
  const cfg = bulletin.logosConfig || { jalShakti: true, swachhata: true, mohua: true, customLogo: null };
  const showJalShakti = cfg.jalShakti !== false;
  const showSwachhata = cfg.swachhata !== false;
  const showMoHUA = cfg.mohua !== false;
  const customLogo = cfg.customLogo ? getImageSync(cfg.customLogo) : null;

  const hasAnyLogo = showJalShakti || showSwachhata || showMoHUA || customLogo;

  let contentHtml = "";
  if (!hasAnyLogo) {
    contentHtml = `<span class="header-logos-empty-notice">(No header emblems selected — configure in 🏛️ Logos)</span>`;
  } else {
    contentHtml = `
      <div class="header-logos-container">
        <div class="header-logo-slot slot-left">
          ${showJalShakti ? '<img src="assets/logo_jalshakti.png" class="header-logo-img logo-jalshakti" alt="Ministry of Jal Shakti">' : ''}
        </div>
        <div class="header-logo-slot slot-center">
          ${showSwachhata ? '<img src="assets/logo_swachhata.png" class="header-logo-img logo-swachhata" alt="Swachhata Hi Seva 2026">' : ''}
          ${customLogo ? `<img src="${customLogo}" class="header-logo-img logo-custom" alt="State / Municipal Seal">` : ''}
        </div>
        <div class="header-logo-slot slot-right">
          ${showMoHUA ? '<img src="assets/logo_mohua.png" class="header-logo-img logo-mohua" alt="Ministry of Housing and Urban Affairs">' : ''}
        </div>
      </div>
    `;
  }

  return `
    ${page && page.isLocked ? '<span class="lock-badge">🔒 Header Locked</span>' : ''}
    ${contentHtml}
  `;
}

// ==================== LOGO MANAGER ====================
let tempCustomLogoDataUrl = null;

function openLogoModal() {
  const cfg = bulletin.logosConfig || { jalShakti: true, swachhata: true, mohua: true, customLogo: null };
  document.getElementById("chkLogoJalShakti").checked = cfg.jalShakti !== false;
  document.getElementById("chkLogoSwachhata").checked = cfg.swachhata !== false;
  document.getElementById("chkLogoMoHUA").checked = cfg.mohua !== false;

  tempCustomLogoDataUrl = cfg.customLogo ? getImageSync(cfg.customLogo) : null;
  const customStatus = document.getElementById("customLogoStatus");
  const btnClear = document.getElementById("btnClearCustomLogo");

  if (tempCustomLogoDataUrl) {
    if (customStatus) {
      customStatus.style.display = "block";
      customStatus.textContent = "✓ Custom state/municipal seal attached";
    }
    if (btnClear) btnClear.style.display = "inline-block";
  } else {
    if (customStatus) customStatus.style.display = "none";
    if (btnClear) btnClear.style.display = "none";
  }

  updateModalLogoPreview();
  document.getElementById("logoModal").classList.add("open");
}

function onLogoToggleChange() {
  if (!bulletin.logosConfig) {
    bulletin.logosConfig = { jalShakti: true, swachhata: true, mohua: true, customLogo: null };
  }
  const chkJal = document.getElementById("chkLogoJalShakti");
  const chkSwachh = document.getElementById("chkLogoSwachhata");
  const chkMo = document.getElementById("chkLogoMoHUA");

  if (chkJal) bulletin.logosConfig.jalShakti = chkJal.checked;
  if (chkSwachh) bulletin.logosConfig.swachhata = chkSwachh.checked;
  if (chkMo) bulletin.logosConfig.mohua = chkMo.checked;

  updateModalLogoPreview();
  renderCanvas();
  setUnsavedStatus(true);
}

function updateModalLogoPreview() {
  const container = document.getElementById("headerPreviewContainer");
  if (!container) return;

  const showJalShakti = document.getElementById("chkLogoJalShakti") ? document.getElementById("chkLogoJalShakti").checked : true;
  const showSwachhata = document.getElementById("chkLogoSwachhata") ? document.getElementById("chkLogoSwachhata").checked : true;
  const showMoHUA = document.getElementById("chkLogoMoHUA") ? document.getElementById("chkLogoMoHUA").checked : true;
  const customLogo = tempCustomLogoDataUrl;

  const hasAnyLogo = showJalShakti || showSwachhata || showMoHUA || customLogo;

  if (!hasAnyLogo) {
    container.innerHTML = `<span class="header-logos-empty-notice">(All emblems unchecked — header will appear clean/blank)</span>`;
    return;
  }

  container.innerHTML = `
    <div class="header-logos-container">
      <div class="header-logo-slot slot-left">
        ${showJalShakti ? '<img src="assets/logo_jalshakti.png" class="header-logo-img logo-jalshakti" alt="Ministry of Jal Shakti">' : ''}
      </div>
      <div class="header-logo-slot slot-center">
        ${showSwachhata ? '<img src="assets/logo_swachhata.png" class="header-logo-img logo-swachhata" alt="Swachhata Hi Seva 2026">' : ''}
        ${customLogo ? `<img src="${customLogo}" class="header-logo-img logo-custom" alt="State / Municipal Seal">` : ''}
      </div>
      <div class="header-logo-slot slot-right">
        ${showMoHUA ? '<img src="assets/logo_mohua.png" class="header-logo-img logo-mohua" alt="Ministry of Housing and Urban Affairs">' : ''}
      </div>
    </div>
  `;
}

function handleCustomLogoUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      tempCustomLogoDataUrl = ev.target.result;
      const customStatus = document.getElementById("customLogoStatus");
      const btnClear = document.getElementById("btnClearCustomLogo");
      if (customStatus) {
        customStatus.style.display = "block";
        customStatus.textContent = "✓ Custom seal ready: " + file.name;
      }
      if (btnClear) btnClear.style.display = "inline-block";
      updateModalLogoPreview();
      onLogoToggleChange();
    };
    reader.readAsDataURL(file);
  }
}

function clearCustomLogo() {
  tempCustomLogoDataUrl = null;
  const uploader = document.getElementById("customLogoUploader");
  if (uploader) uploader.value = "";
  const customStatus = document.getElementById("customLogoStatus");
  const btnClear = document.getElementById("btnClearCustomLogo");
  if (customStatus) customStatus.style.display = "none";
  if (btnClear) btnClear.style.display = "none";
  if (!bulletin.logosConfig) bulletin.logosConfig = {};
  bulletin.logosConfig.customLogo = null;
  updateModalLogoPreview();
  renderCanvas();
  setUnsavedStatus(true);
}

async function saveLogosConfig() {
  pushState();
  onLogoToggleChange();

  if (tempCustomLogoDataUrl) {
    if (tempCustomLogoDataUrl.startsWith("data:")) {
      const compressed = await compressImage(tempCustomLogoDataUrl, 800, 300);
      const imgRef = await storeImage(compressed);
      bulletin.logosConfig.customLogo = imgRef;
    } else {
      bulletin.logosConfig.customLogo = tempCustomLogoDataUrl;
    }
  } else {
    bulletin.logosConfig.customLogo = null;
  }

  renderCanvas();
  saveToLocalStorage();
  document.getElementById("logoModal").classList.remove("open");
  showToast("Official header emblems updated across all pages!", "success");
}

function resetDefaultLogos() {
  pushState();
  bulletin.logosConfig = { jalShakti: true, swachhata: true, mohua: true, customLogo: null };
  tempCustomLogoDataUrl = null;
  if (document.getElementById("chkLogoJalShakti")) document.getElementById("chkLogoJalShakti").checked = true;
  if (document.getElementById("chkLogoSwachhata")) document.getElementById("chkLogoSwachhata").checked = true;
  if (document.getElementById("chkLogoMoHUA")) document.getElementById("chkLogoMoHUA").checked = true;
  const uploader = document.getElementById("customLogoUploader");
  if (uploader) uploader.value = "";
  const customStatus = document.getElementById("customLogoStatus");
  const btnClear = document.getElementById("btnClearCustomLogo");
  if (customStatus) customStatus.style.display = "none";
  if (btnClear) btnClear.style.display = "none";
  updateModalLogoPreview();
  renderCanvas();
  saveToLocalStorage();
  document.getElementById("logoModal").classList.remove("open");
  showToast("Reset to default Government Ministry emblems.", "info");
}

// ==================== GEMINI AI ENGINE ====================
function updateGeminiStatusUI() {
  const savedKey = localStorage.getItem("gov_bulletin_gemini_key");
  const isConfigured = !!(savedKey && savedKey.trim());

  // Top Bar & Home Tab Indicator Dots
  const topDot = document.getElementById("topBarGeminiDot");
  if (topDot) {
    topDot.style.background = isConfigured ? "#10b981" : "#ef4444";
  }
  const homeDot = document.getElementById("homeBarGeminiDot");
  if (homeDot) {
    homeDot.style.background = isConfigured ? "#10b981" : "#ef4444";
  }

  // AI Modal Banner
  const aiDot = document.getElementById("aiModalKeyDot");
  const aiText = document.getElementById("aiModalKeyText");
  const aiBanner = document.getElementById("aiModalKeyBanner");
  if (aiDot && aiText) {
    if (isConfigured) {
      aiDot.style.background = "#10b981";
      aiText.innerHTML = `Google Gemini 2.0 Flash: <span style="color:#10b981; font-weight:700;">Connected (Free Tier)</span>`;
      if (aiBanner) aiBanner.style.borderColor = "#059669";
    } else {
      aiDot.style.background = "#ef4444";
      aiText.innerHTML = `Google Gemini 2.0 Flash: <span style="color:#f87171;">Offline (No API Key)</span>`;
      if (aiBanner) aiBanner.style.borderColor = "#334155";
    }
  }

  // Gemini Settings Modal Status Badge
  const badge = document.getElementById("geminiKeyStatusBadge");
  if (badge) {
    if (isConfigured) {
      badge.textContent = "Active (Free Tier)";
      badge.style.background = "#064e3b";
      badge.style.color = "#34d399";
    } else {
      badge.textContent = "Not Configured";
      badge.style.background = "#334155";
      badge.style.color = "#94a3b8";
    }
  }
}

function toggleShowGeminiKey() {
  const input = document.getElementById("geminiApiKeyInput");
  const btn = document.getElementById("btnToggleShowKey");
  if (!input || !btn) return;
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁️";
  }
}

function initGeminiSettings() {
  const savedKey = localStorage.getItem("gov_bulletin_gemini_key");
  const input = document.getElementById("geminiApiKeyInput");
  if (savedKey && input) {
    input.value = savedKey;
  }
  updateGeminiStatusUI();
}

function openGeminiSettings() {
  const modal = document.getElementById("geminiSettingsModal");
  const savedKey = localStorage.getItem("gov_bulletin_gemini_key");
  const input = document.getElementById("geminiApiKeyInput");
  if (savedKey && input) {
    input.value = savedKey;
  }
  const statusEl = document.getElementById("geminiTestStatus");
  if (savedKey) {
    statusEl.style.display = "block";
    statusEl.style.background = "rgba(16, 185, 129, 0.15)";
    statusEl.style.border = "1px solid #059669";
    statusEl.innerHTML = `<span style="color:#10b981; font-weight:700;">✓ Key Configured Locally</span><br><span style="font-size:11px; color:#cbd5e1;">Connected to Gemini 2.0 Flash (Free Tier).</span>`;
  } else {
    statusEl.style.display = "none";
  }
  updateGeminiStatusUI();
  modal.classList.add("open");
}

function saveGeminiKey() {
  const input = document.getElementById("geminiApiKeyInput");
  const key = input.value.trim();
  if (key) {
    localStorage.setItem("gov_bulletin_gemini_key", key);
    showToast("Gemini API key saved securely!", "success");
  } else {
    localStorage.removeItem("gov_bulletin_gemini_key");
    showToast("Gemini API key removed.", "info");
  }
  updateGeminiStatusUI();
  document.getElementById("geminiSettingsModal").classList.remove("open");
}

function clearGeminiKey() {
  localStorage.removeItem("gov_bulletin_gemini_key");
  document.getElementById("geminiApiKeyInput").value = "";
  const statusEl = document.getElementById("geminiTestStatus");
  statusEl.style.display = "block";
  statusEl.style.background = "rgba(100, 116, 139, 0.2)";
  statusEl.style.border = "1px solid #475569";
  statusEl.innerHTML = `<span style="color:#94a3b8;">Key cleared. Offline template fallback active.</span>`;
  updateGeminiStatusUI();
  showToast("Gemini API key cleared.", "info");
}

async function testGeminiKey() {
  const input = document.getElementById("geminiApiKeyInput");
  const key = input.value.trim();
  const statusEl = document.getElementById("geminiTestStatus");
  statusEl.style.display = "block";

  if (!key) {
    statusEl.style.background = "rgba(239, 68, 68, 0.15)";
    statusEl.style.border = "1px solid #dc2626";
    statusEl.innerHTML = `<span style="color:#ef4444; font-weight:700;">Please paste an API key first.</span>`;
    return;
  }

  statusEl.style.background = "rgba(56, 189, 248, 0.15)";
  statusEl.style.border = "1px solid #0284c7";
  statusEl.innerHTML = `<span style="color:#38bdf8;">Connecting to Google Gemini 2.0 Flash...</span>`;

  const startTime = Date.now();
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Respond with the word 'OK' only." }] }]
      })
    });

    const elapsed = Date.now() - startTime;
    if (res.ok) {
      statusEl.style.background = "rgba(16, 185, 129, 0.15)";
      statusEl.style.border = "1px solid #059669";
      statusEl.innerHTML = `<span style="color:#10b981; font-weight:700;">✅ Connected successfully to Google Gemini 2.0 Flash (${elapsed}ms)!</span><br><span style="font-size:11px; color:#cbd5e1;">API Key verified and auto-saved to local app storage.</span>`;
      localStorage.setItem("gov_bulletin_gemini_key", key);
      updateGeminiStatusUI();
      showToast("Gemini API verified and saved!", "success");
    } else {
      const errData = await res.json().catch(() => ({}));
      const msg = (errData.error && errData.error.message) || res.statusText;
      statusEl.style.background = "rgba(239, 68, 68, 0.15)";
      statusEl.style.border = "1px solid #dc2626";
      statusEl.innerHTML = `<span style="color:#ef4444; font-weight:700;">❌ Connection failed:</span> <span style="color:#fca5a5;">${msg}</span>`;
    }
  } catch (err) {
    statusEl.style.background = "rgba(239, 68, 68, 0.15)";
    statusEl.style.border = "1px solid #dc2626";
    statusEl.innerHTML = `<span style="color:#ef4444; font-weight:700;">❌ Network error:</span> <span style="color:#fca5a5;">Could not reach Google API. Check internet connection.</span>`;
  }
}

async function callGeminiApi(prompt, systemInstruction = "") {
  const key = localStorage.getItem("gov_bulletin_gemini_key");
  if (!key) return null;

  try {
    const bodyPayload = {
      contents: [{ parts: [{ text: prompt }] }]
    };
    if (systemInstruction) {
      bodyPayload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload)
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.warn("Gemini call error:", err);
    return null;
  }
}

// 1-Click AI Trim to Fit Layout
async function triggerAiTrim(btn) {
  const area = btn.closest(".page-content-area");
  if (!area) return;

  const blurbs = area.querySelectorAll(".story-blurb");
  if (blurbs.length === 0) return;

  let targetBlurb = blurbs[0];
  blurbs.forEach(b => {
    if (b.innerText.length > targetBlurb.innerText.length) targetBlurb = b;
  });

  const originalText = targetBlurb.innerText.trim();
  showToast("Condensing text to fit A4 layout...", "info", 4000);

  const key = localStorage.getItem("gov_bulletin_gemini_key");
  let trimmed = null;

  if (key) {
    trimmed = await callGeminiApi(
      `Condense this Indian government bulletin story to exactly 35-40 words. Keep all specific numbers, names, locations, and official achievements intact in formal PIB tone:\n\n${originalText}`,
      "You are an editor for the official Indian Swachhata Hi Seva Daily Bulletin. Output ONLY the condensed paragraph with no preamble."
    );
  }

  // Fallback offline trimming
  if (!trimmed) {
    const sentences = originalText.split(/(?<=[.!?])\s+/);
    if (sentences.length > 2) {
      trimmed = sentences.slice(0, 2).join(" ");
    } else {
      trimmed = originalText.slice(0, Math.round(originalText.length * 0.8)) + "...";
    }
  }

  pushState();
  targetBlurb.innerText = trimmed.trim();

  const pageCard = btn.closest(".a4-page");
  if (pageCard) {
    const pIdx = parseInt(pageCard.id.replace("page-card-", ""), 10);
    const blurbIndex = Array.from(blurbs).indexOf(targetBlurb);
    if (!isNaN(pIdx) && bulletin.pages[pIdx]?.stories?.[blurbIndex]) {
      bulletin.pages[pIdx].stories[blurbIndex].blurb = targetBlurb.innerText;
    }
  }

  setTimeout(checkPageOverflow, 100);
  showToast("Text trimmed! Page layout balanced.", "success");
}

// Bulk Ingestion & WhatsApp Parser
async function handleBulkIngestSubmit() {
  const rawText = document.getElementById("bulkIngestRawText").value.trim();
  const useGemini = document.getElementById("checkUseGeminiParsing").checked;

  if (!rawText) {
    showToast("Please paste some field notes or WhatsApp messages.", "warn");
    return;
  }

  showToast("Ingesting stories...", "info", 5000);
  document.getElementById("bulkIngestModal").classList.remove("open");

  const key = localStorage.getItem("gov_bulletin_gemini_key");

  if (useGemini && key) {
    const systemPrompt = `You are an editor for the official Indian Swachhata Hi Seva Daily Bulletin. Parse the raw unstructured notes into a JSON array of stories. Each story object MUST have:
- title: concise formal headline (max 10 words)
- location: City, State or Ward
- category: one of ["Top Stories", "State & ULB", "Citizen Participation", "CTU Transformation", "SafaiMitra Suraksha"]
- blurb: official PIB tone summary of work accomplished (strictly 35-45 words)
Return ONLY a valid JSON array. No markdown, no commentary.`;

    const aiResponse = await callGeminiApi(rawText, systemPrompt);
    if (aiResponse) {
      try {
        const cleaned = aiResponse.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length > 0) {
          pushState();
          parsed.forEach(item => {
            bulletin.segments.unshift({
              id: "seg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
              title: item.title || "Government Initiative",
              location: item.location || "Ground Location",
              category: item.category || "State & ULB",
              blurb: item.blurb || "",
              photos: ["assets/sample1.jpg"],
              status: "Ready",
              isFavorite: false
            });
          });
          renderSegmentDrawer();
          showToast(`Ingested ${parsed.length} structured stories with Gemini AI!`, "success");
          return;
        }
      } catch (err) {
        console.warn("JSON parse error from Gemini bulk ingest:", err);
      }
    }
  }

  // Offline fallback: split by double line breaks
  pushState();
  const blocks = rawText.split(/\n\s*\n/).filter(b => b.trim());
  blocks.forEach(block => {
    const lines = block.trim().split("\n");
    bulletin.segments.unshift({
      id: "seg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      title: lines[0].trim().substring(0, 75),
      location: "District / Ward",
      category: "State & ULB",
      blurb: lines.slice(1).join(" ").trim() || lines[0].trim(),
      photos: ["assets/sample1.jpg"],
      status: "Ready",
      isFavorite: false
    });
  });

  renderSegmentDrawer();
  showToast(`Ingested ${blocks.length} story segments into pool!`, "success");
}

// ==================== AI COPYWRITER & TEMPLATE COPY GENERATOR ====================
async function runAiGenerateCopy() {
  const section = document.getElementById("aiSectionSelect").value;
  const lang = document.getElementById("aiLanguageSelect").value;
  const location = document.getElementById("aiLocationInput").value.trim() || "State / ULB Ward";
  const notes = document.getElementById("aiRawNotes").value.trim();

  if (!notes) {
    showToast("Please enter field notes or bullet points.", "warn");
    return;
  }

  const key = localStorage.getItem("gov_bulletin_gemini_key");
  if (key) {
    showToast("Consulting Gemini AI with PIB journalistic guidelines...", "info", 5000);
    const systemInstruction = `You are a Senior Editor for the Press Information Bureau (PIB) and Swachh Bharat Mission, Government of India.
Generate:
1. A formal, authoritative headline (max 10-12 words).
2. A formal 35-45 word blurb highlighting citizen participation, administrative leadership, and tangible ground impact.
Language: ${lang === "hi" ? "High-standard formal Hindi (राजभाषा मानक)" : "Formal Indian bureaucratic English"}.
Output format:
HEADLINE: <headline>
BLURB: <blurb>`;

    const prompt = `Section: ${section}\nLocation: ${location}\nField Notes: ${notes}`;
    const result = await callGeminiApi(prompt, systemInstruction);

    if (result) {
      const headlineMatch = result.match(/HEADLINE:\s*(.*)/i);
      const blurbMatch = result.match(/BLURB:\s*([\s\S]*)/i);

      if (headlineMatch && blurbMatch) {
        document.getElementById("aiResultHeadline").value = headlineMatch[1].trim();
        document.getElementById("aiResultBlurb").value = blurbMatch[1].trim();
        showToast("✨ Generated PIB-grade copy with Google Gemini 2.0 Flash!", "success");
        return;
      }
    }
    showToast("⚠️ Gemini call failed. Falling back to official template.", "warn", 5000);
  }

  // Offline Template Engine Fallback
  let headline = "";
  let blurb = "";

  if (lang === "hi") {
    if (section === "Top Stories") {
      headline = `${location}: मुख्यमंत्री एवं प्रशासनिक नेतृत्व में समुद्र तट एवं सार्वजनिक स्वच्छता अभियान संपन्न`;
      blurb = `विशाखापट्टनम और पुरी की तर्ज पर ${location} में विशेष जन-आंदोलन का आयोजन किया गया। इस दौरान ${notes} को केंद्र में रखते हुए 1200 से अधिक नागरिकों एवं सफाईकर्मियों ने भागीदारी की।`;
    } else if (section === "CTU Transformation") {
      headline = `${location} में स्वच्छता लक्षित इकाई (CTU) का सफल कायाकल्प; कचरा स्थल रूपांतरित`;
      blurb = `मध्य प्रदेश के रीवा और तिरुपति की भांति ${location} में गंभीर कचरा ब्लैकस्पॉट का पूर्ण उपचार कर उसे हरित सार्वजनिक स्थल में बदला गया। इस कार्य में ${notes} की अहम भूमिका रही।`;
    } else {
      headline = `${location}: स्वच्छता ही सेवा के अंतर्गत सघन जन-जागरूकता एवं स्वच्छता अभियान`;
      blurb = `${location} में नगर निगम प्रशासन एवं स्वयंसेवकों के संयुक्त तत्वावधान में विशेष स्वच्छता अभियान संचालित किया गया। इस दौरान ${notes} पर विशेष ध्यान देते हुए सामूहिक श्रमदान सुनिश्चित किया गया।`;
    }
  } else {
    if (section === "Top Stories") {
      headline = `${location} Spearheads Mega Ground Action Under Swachhata Hi Seva`;
      blurb = `Leadership and municipal administration reviewed major cleanliness drives across public avenues at ${location}. The initiative mobilized citizen volunteers and mechanized sanitation units, focusing on ${notes.toLowerCase()}.`;
    } else if (section === "CTU Transformation") {
      headline = `${location} Blackspot Successfully Remediated into Clean Public Zone`;
      blurb = `A persistent open waste spot at ${location} was completely cleared and landscaped under the CTU transformation initiative, resolving ${notes.toLowerCase()} through dedicated civic action.`;
    } else {
      headline = `${location} Municipal Corporation Launches Intensive Sanitation Drive`;
      blurb = `Under the Swachhata Hi Seva campaign, municipal teams and citizen groups mobilized across ${location} to execute targeted cleaning. The drive focused on ${notes.toLowerCase()}, demonstrating robust ground impact.`;
    }
  }

  document.getElementById("aiResultHeadline").value = headline;
  document.getElementById("aiResultBlurb").value = blurb;
  if (!key) {
    showToast("Generated copy from offline template. Connect Gemini Key above for live AI!", "info", 5000);
  }
}

function saveAiToSegment() {
  const headline = document.getElementById("aiResultHeadline").value;
  const blurb = document.getElementById("aiResultBlurb").value;
  const location = document.getElementById("aiLocationInput").value || "Location";

  if (!headline || !blurb) {
    showToast("Please generate the copy first!", "warn");
    return;
  }

  pushState();
  if (!bulletin.segments) bulletin.segments = [];
  bulletin.segments.unshift({
    id: "seg-" + Date.now(),
    title: headline,
    category: document.getElementById("aiSectionSelect").value,
    location: location,
    blurb: blurb,
    photos: ["assets/sample1.jpg"],
    status: "Ready",
    isFavorite: false
  });

  renderSegmentDrawer();
  document.getElementById("aiModal").classList.remove("open");
  showToast("Saved copy as a new story segment in the pool!", "success");
}

function applyAiToActivePage() {
  const headline = document.getElementById("aiResultHeadline").value;
  const blurb = document.getElementById("aiResultBlurb").value;

  if (!headline || !blurb) {
    showToast("Please generate the copy first!", "warn");
    return;
  }

  pushState();
  const page = bulletin.pages[activePageIndex];
  if (page.stories && page.stories.length > 0) {
    page.stories[0].headline = headline;
    page.stories[0].blurb = blurb;
    renderCanvas();
    document.getElementById("aiModal").classList.remove("open");
    showToast(`Applied copy directly to Page ${activePageIndex + 1}!`, "success");
  } else {
    showToast("Selected page does not have a story slot. Select an editorial story page.", "warn");
  }
}

// Template selection prompt for + Add Page
function showAddPagePrompt() {
  const templates = [
    { name: "3-Story Page (State & ULB Initiatives)", type: "standard-3-story", theme: "theme-blue", section: "State & ULB Initiatives" },
    { name: "3-Story Page (Citizen Participation)", type: "standard-3-story", theme: "theme-saffron", section: "Citizen Participation" },
    { name: "3-Story Page (Green Earth & Circular Economy)", type: "standard-3-story", theme: "theme-emerald", section: "Paryavaran & Circular Living" },
    { name: "3-Story Page (SafaiMitra Welfare & Dignity)", type: "standard-3-story", theme: "theme-purple", section: "SafaiMitra Suraksha Evam Samman" },
    { name: "CTU Transformation (Before & After Cards)", type: "ctu-transformation", theme: "theme-crimson", section: "CTU Transformations in Focus" },
    { name: "2-Story Split Page (Top Stories)", type: "split-2-story", theme: "theme-orange", section: "Top Stories of the Day" },
    { name: "2-Story Split Page (Smart City Operations)", type: "split-2-story", theme: "theme-indigo", section: "Smart City & Municipal Operations" },
    { name: "2-Story Split Page (Jal Shakti & Clean Rivers)", type: "split-2-story", theme: "theme-cyan", section: "Jal Shakti & Coastal Cleanliness" },
    { name: "1-Hero Big Story (VIP / Lead Field Event)", type: "hero-1-story", theme: "theme-navy", section: "Top Stories of the Day" },
    { name: "Spotlight 6-Photo Grid (Action Gallery)", type: "spotlight-6", theme: "theme-slate", section: "Swachhata in Spotlight" },
    { name: "Overall Snapshot (Stats Table)", type: "snapshot", theme: "theme-green", section: "Overall Snapshot" },
    { name: "Cover Page (Executive / Thematic)", type: "cover", theme: "theme-navy", section: "Cover Page" },
    { name: "Back Cover (Visit Us & Media Channels)", type: "visit-us", theme: "theme-teal", section: "Back Cover" }
  ];

  let promptText = "Choose page template number to insert:\n";
  templates.forEach((t, i) => {
    promptText += `${i + 1}. ${t.name}\n`;
  });

  const choice = prompt(promptText, "1");
  if (!choice) return;
  const num = parseInt(choice, 10);
  if (isNaN(num) || num < 1 || num > templates.length) return;

  const sel = templates[num - 1];
  pushState();

  const newPage = {
    id: "p-" + Date.now(),
    type: sel.type,
    theme: sel.theme,
    sectionTitle: sel.section,
    stories: [
      { headline: "Enter Story Headline Here", blurb: "Enter 3-4 sentence official description...", images: ["assets/sample1.jpg"] },
      { headline: "Community Mobilization Drive", blurb: "Citizens and local authorities join hands...", images: ["assets/sample3.jpg"] },
      { headline: "Youth Awareness Campaign", blurb: "Students lead rallies and pledge ceremonies...", images: ["assets/sample4.jpg"] }
    ]
  };

  if (sel.type === "ctu-transformation") {
    newPage.pairCount = 2;
    newPage.ctuPairs = [
      { title: "Transformation Unit #1", location: "Ward 14", beforeImg: "assets/sample10.jpg", afterImg: "assets/sample6.jpg", beforeDate: "15th Sept", afterDate: "20th Sept", desc: "Before and after cleanliness drive outcomes." },
      { title: "Transformation Unit #2", location: "Central Market", beforeImg: "assets/sample4.jpg", afterImg: "assets/sample3.jpg", beforeDate: "16th Sept", afterDate: "20th Sept", desc: "Garbage blackspot transformed into clean area." }
    ];
  }

  bulletin.pages.push(newPage);
  activePageIndex = bulletin.pages.length - 1;
  renderAll();
  scrollToPage(activePageIndex);
  showToast(`Added new ${sel.name}!`, "success");
}
