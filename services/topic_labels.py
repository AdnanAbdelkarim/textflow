"""
Topic labeling utilities.

Maps topic word distributions (from LDA) to human-readable category labels
using a curated category->vocabulary dictionary. Falls back to auto-generated
labels (e.g., "Loan • bank • payment") when no category matches.
"""
import re
from collections import defaultdict


# Domain category map: each label maps to a set of representative vocabulary words.
# Curated for typical NLP/business datasets. Extend as needed.
category_map = {
    "AI & Machine Learning": {"ai","ml","machine","learning","model","training","inference","classification","regression","clustering","feature","pipeline","autoML","sklearn","tensorflow","pytorch"},
    "Natural Language Processing": {"nlp","text","token","embedding","bert","transformer","topic","ner","sentiment","lemmatization","stemming","language","corpus","chatbot"},
    "Computer Vision": {"vision","image","video","object","detection","segmentation","yolo","opencv","cnn","recognition","ocr","keypoints","bounding"},
    "Data Engineering": {"etl","elt","ingest","pipeline","airflow","prefect","dbt","orchestration","batch","stream","kafka","spark","delta","iceberg"},
    "Databases & Storage": {"sql","nosql","postgres","mysql","sqlite","mongodb","index","query","transaction","warehouse","lake","backup","replication"},
    "Big Data & Analytics": {"spark","hadoop","hive","presto","athena","parquet","olap","bi","dashboard","analytics","cube","snowflake","powerbi","tableau"},
    "Cloud Platforms": {"aws","azure","gcp","bucket","s3","ec2","lambda","cloudrun","functions","iam","vpc","gke","eks","aks"},
    "DevOps & CI/CD": {"devops","ci","cd","gitlab","github","actions","jenkins","docker","container","kubernetes","helm","terraform","ansible","monitoring"},
    "APIs & Integration": {"api","rest","graphql","endpoint","webhook","oauth","jwt","rate","throttle","sdk","contract","swagger","openapi"},
    "Web Development": {"html","css","javascript","typescript","react","vue","angular","next","node","express","flask","django","frontend","backend","fullstack"},
    "Mobile Apps": {"android","ios","swift","kotlin","flutter","reactnative","apk","ipa","play","appstore","push","mobile"},
    "Networking": {"tcp","udp","ip","dns","dhcp","latency","bandwidth","firewall","router","switch","proxy","loadbalancer","tls"},
    "Cybersecurity": {"security","breach","attack","phishing","malware","ransomware","encryption","key","token","zero","siem","soc","vulnerability","patch"},
    "Privacy & Compliance": {"gdpr","hipaa","pci","sox","iso","compliance","policy","consent","retention","dpa","audit"},
    "Identity & Access": {"auth","authentication","authorization","sso","saml","oauth","openid","mfa","password","role","iam"},
    "Logging & Observability": {"log","metrics","tracing","otel","prometheus","grafana","sentry","datadog","alert","dashboard"},
    "Math & Statistics": {"statistics","probability","distribution","bayes","regression","anova","hypothesis","correlation","pvalue","feature","normalization"},
    "Optimization & OR": {"optimization","linear","integer","lp","ilp","solver","heuristic","metaheuristic","constraint","schedule","routing"},
    "Blockchain & Web3": {"blockchain","crypto","ethereum","solidity","smart","contract","wallet","nft","defi","ledger"},
    "IoT & Edge": {"iot","sensor","edge","mqtt","telemetry","firmware","gateway","device","embedded","rtos"},
    "GIS & Mapping": {"map","gis","geospatial","coordinate","latitude","longitude","geocode","leaflet","arcgis","shapefile"},
    "Robotics & Automation": {"robot","ros","autonomous","drone","navigation","actuator","sensor","slam","path"},
    "Finance & FinTech": {"bank","loan","credit","debit","payment","gateway","ledger","account","interest","forex","trading","wallet","fintech"},
    "Accounting": {"invoice","expense","reconciliation","ledger","journal","payable","receivable","audit","closing","statement"},
    "Insurance": {"policy","premium","claim","underwriting","risk","actuary","coverage","broker"},
    "Real Estate": {"property","mortgage","lease","tenant","landlord","valuation","listing","zillow","mls"},
    "Healthcare & Medicine": {"patient","clinical","diagnosis","treatment","hospital","clinic","ehr","radiology","lab","vaccine","symptom"},
    "Pharma & Biotech": {"trial","phase","protocol","drug","compound","assay","molecule","gene","biomarker"},
    "Education & EdTech": {"student","course","curriculum","lesson","exam","lms","mooc","teacher","classroom","university"},
    "Marketing & Growth": {"campaign","advertisement","ad","seo","sem","branding","crm","lead","conversion","funnel","retention"},
    "Sales & CRM": {"deal","pipeline","quote","opportunity","account","contact","crm","territory","forecast"},
    "Customer Support": {"ticket","helpdesk","sla","csat","nps","chat","knowledge","faq","zendesk","freshdesk"},
    "Retail & E-commerce": {"catalog","product","cart","checkout","order","inventory","sku","price","discount","delivery","return"},
    "Logistics & Supply Chain": {"warehouse","shipment","freight","tracking","route","fleet","3pl","inventory","forecasting","procurement"},
    "Automotive & EV": {"vehicle","vin","ecu","can","ev","battery","charging","station","motor","telemetry"},
    "Energy & Utilities": {"grid","power","electricity","gas","oil","renewable","solar","wind","meter","tariff"},
    "Manufacturing & Industry 4.0": {"factory","plc","scada","mes","bom","quality","oee","maintenance","predictive"},
    "Government & Public Sector": {"policy","regulation","permit","tender","procurement","census","public","municipal"},
    "Legal": {"contract","agreement","clause","case","litigation","compliance","privacy","license","ip","dispute"},
    "Human Resources": {"employee","hiring","recruitment","interview","onboarding","payroll","benefits","performance","resignation"},
    "Media & Entertainment": {"content","streaming","video","audio","music","license","ad","rights","broadcast"},
    "Agriculture": {"farm","crop","yield","soil","irrigation","livestock","drone","satellite"},
    "Construction & Engineering": {"project","contractor","bid","tender","blueprint","permit","inspection","compliance","safety"},
    "Sustainability & Environment": {"climate","carbon","emission","offset","recycle","waste","footprint","sustainability","green","energy"},
    "Email & Messaging": {"email","newsletter","unsubscribe","inbox","gmail","outlook","smtp","imap","groups","list","thread","message"},
    "Web & URLs": {"url","link","hyperlink","domain","website","http","https","www","page"},
    "Spam & Promotions": {"spam","promotion","promo","discount","coupon","offer","sale","deal", "lottery","winner","prize","free","click","urgent"},
    "E-commerce & Marketplaces": {"ebay","amazon","aliexpress","marketplace","seller","buyer","auction","bid", "cart","checkout","order","item","price","shipping","return"},
    "Travel & Hospitality": {"booking","reservation","flight","hotel","tour","guest","checkin","loyalty", "airport","airline","flight","hotel","marriott","reservation","booking", "checkin","checkout","luggage","visa","passport"},
    "Sports": {"sports","football","soccer","nfl","nba","match","game","score","league", "tournament","fifa","uefa","chiefs","mariners","lakers","patriots"},
    "Social Media & Communities": {"facebook","twitter","x","instagram","tiktok","reddit","discord","telegram","whatsapp","subreddit","forum","channel","group"},
    "Files & Media": {"pdf","doc","docx","xls","xlsx","ppt","pptx","zip","rar","attachment","image","photo","jpg","jpeg","png","gif","video","audio","mp3","mp4"},
    "Recruiting & Jobs": {"job","jobs","vacancy","opening","position","role","recruiter","hiring","resume","cv","apply","application","interview","salary","offer"},
    "News & Politics": {"news","headline","press","policy","politics","election","vote","minister","president","parliament","senate","congress"},
    "General Chatter": {"hello","hi","thanks","regards","please","contact","reply","forward","dear","mr","mrs","sir","madam"},
    "Tech Support": {"error","issue","problem","bug","fix","install","update","patch","troubleshoot","reset","support","ticket"},
    "Culture & Entertainment": {"movie","film","music","song","concert","festival","tv","series","show","game","gaming","xbox","playstation","nintendo","anime","comic"},
    "Science & Research": {"research","study","experiment","data","analysis","theory","journal","paper","review","publication","science","biology","physics","chemistry"},
    "Shopping & Retail": {"buy","purchase","order","shop","store","brand","retail","fashion","clothes","apparel","electronics","grocery"},
    "Education & Training": {"school","college","university","student","teacher","exam","class","grade","assignment","homework","training","course","certificate","diploma"},
    "Events & Conferences": {"conference","meeting","seminar","workshop","webinar","agenda","schedule","talk","presentation","expo","summit"},
    "Religion & Spirituality": {"church","mosque","temple","bible","quran","prayer","god","faith","spiritual","religion","belief"},
    "Geography & Places": {"northern","southern","eastern","western","city","town","village","capital","region","province","territory","new","old","central", "north", "south", "east", "west", "city","country","state","region","province","capital","usa","europe","asia","africa","middleeast","qatar","doha","jordan","amman"},
    "Programming Languages": {"python","java","c","c++","c#","javascript","typescript","php","ruby","go","rust","swift","kotlin","matlab","r","perl","fortran","haskell"},
    "AI Ethics & Safety": {"ethics","bias","fairness","responsibility","accountability","safety","alignment","explainability","trust","responsible","ai","governance"},
    "Gaming & Esports": {"game","gaming","xbox","playstation","nintendo","steam","tournament","league","esports","gamer","fortnite","minecraft","valorant","dota","lol"},
    "Space & Astronomy": {"nasa","spacex","rocket","launch","mars","moon","satellite","orbit","astronomy","planet","galaxy","star","universe","telescope","hubble"},
    "Human Capital & Workplace": {"employee","employer","salary","benefits","workplace","office","remote","hybrid","team","manager","leader","promotion","fired","hiring"},
    "Banking & Investment": {"bank","credit","debit","loan","mortgage","equity","stock","bond","market","fund","hedge","invest","portfolio","ipo","dividend"},
    "Startups & Entrepreneurship": {"startup","founder","pitch","seed","venture","capital","incubator","accelerator","angel","funding","valuation","scale","exit","unicorn"},
    "Economics": {"economy","inflation","gdp","recession","growth","unemployment","monetary","fiscal","policy","central","bank","currency","trade","tariff"},
    "Food & Cooking": {"food","meal","cook","kitchen","recipe","restaurant","dinner","lunch","breakfast","snack","drink","coffee","tea","beer","wine","bar","menu"},
    "Health & Fitness": {"gym","workout","exercise","training","fitness","run","yoga","diet","nutrition","protein","calories","weight","cardio","muscle","health"},
    "Fashion & Lifestyle": {"clothes","fashion","style","design","brand","shoes","dress","tshirt","jeans","suit","bag","perfume","watch","accessory","luxury"},
    "Movies & TV": {"movie","film","cinema","tv","series","episode","actor","actress","director","oscar","hollywood","bollywood","netflix","disney","hbo"},
    "Music & Audio": {"music","song","album","artist","band","concert","festival","radio","spotify","itunes","sound","guitar","piano","drums","dj","rap","pop","rock"},
    "Crime & Law": {"crime","criminal","murder","robbery","theft","fraud","arrest","court","judge","trial","jury","lawyer","attorney","justice","police"},
    "Military & Defense": {"army","navy","airforce","defense","weapon","gun","missile","tank","war","battle","soldier","military","strategy","nato"},
    "Disasters & Emergencies": {"earthquake","flood","hurricane","storm","tsunami","fire","wildfire","pandemic","epidemic","outbreak","crisis","rescue","emergency","relief"},
    "Climate & Environment": {"climate","globalwarming","warming","co2","carbon","emissions","greenhouse","pollution","renewable","sustainable","biodiversity","wildlife","forest"},
    "Travel & Tourism": {"trip","travel","tourism","vacation","holiday","flight","airport","visa","passport","hotel","hostel","tour","cruise","car","train","bus","ticket"},
    "Household & Family": {"family","home","house","apartment","parent","mother","father","brother","sister","child","kids","baby","marriage","wedding","husband","wife"},
    "Pets & Animals": {"pet","dog","cat","fish","bird","hamster","puppy","kitten","animal","wildlife","zoo","veterinarian","vet"},
    "Shopping & Consumer": {"shop","shopping","buy","sell","store","mall","market","retail","brand","amazon","ebay","walmart","aliexpress","item","product","order","delivery"},
    "Hobbies & Leisure": {"book","read","reading","library","hobby","craft","art","painting","drawing","photo","photography","camera","garden","gardening","outdoor"},
    "Sports & Olympics": {"sport","sports","game","games","tournament","league","match","team","player","score","goal","medal","gold","silver","bronze","athlete","olympic","olympics","worldcup","fifa","uefa","athens","rio","tokyo"},
    "Awards & Competitions": {"award","awards","prize","medal","trophy","contest","competition","open","championship","cup","title","winner","nominee","nomination","festival"},
    "Quantum Computing": {"quantum","qubit","entanglement","superposition","qiskit","quantization","decoherence","quantumcomputer","quantumcircuit"},
    "Augmented & Virtual Reality": {"ar","vr","augmented","virtual","metaverse","headset","oculus","hololens","immersive","simulation"},
    "3D Printing & Manufacturing": {"3dprinting","additivemanufacturing","printer","filament","resin","prototype","cad","stl","modeling"},
    "Smart Cities": {"smartcity","urban","traffic","infrastructure","mobility","sustainability","transport","governance","sensor"},
    "Telecommunications": {"5g","4g","lte","network","carrier","spectrum","tower","antenna","fiber","telecom","broadband"},
    "Human-Computer Interaction": {"interface","interaction","usability","ux","ui","design","accessibility","hci","prototype","wireframe"},
    "Cyber Threat Intelligence": {"threat","mitre","attackmatrix","malware","forensics","cyberattack","threatintel","ransomware","exploit","vulnerability"},
    "Generative AI": {"genai","llm","chatgpt","gpt","diffusion","texttoimage","textgeneration","prompt","stable","midjourney"},
    "SaaS & B2B Platforms": {"saas","b2b","subscription","enterprise","crm","erp","customer","platform","service","dashboard"},
    "Quantum Cryptography": {"quantumkey","qkd","quantumcryptography","entanglement","securecommunication"},
    "Healthcare AI": {"diagnosis","medicalimage","radiology","mlhealth","predictivediagnosis","ehr","patientdata"},
    "Biotechnology": {"genome","crispr","biotech","geneediting","protein","enzyme","cellculture","rna","dna"},
    "Renewable Energy": {"solar","wind","hydro","geothermal","renewable","cleanenergy","sustainability","greenpower"},
    "Smart Home": {"smarthome","iot","alexa","googlehome","automation","lighting","thermostat","device","assistant"},
    "Aerospace & Aviation": {"aircraft","aviation","flight","drone","uav","aerospace","airline","airport","boeing","airbus"},
    "Space Exploration": {"mars","nasa","rocket","mission","launch","satellite","spacecraft","orbital","asteroid"},
    "Transportation & Mobility": {"electricvehicle","autonomouscar","ev","charging","mobility","transportation","ride","fleet"},
    "Digital Twins": {"digitaltwin","simulation","virtualmodel","predictivemaintenance","systemmodeling"},
    "Supply Chain Analytics": {"logistics","warehouse","inventory","demandforecasting","procurement","distribution"},
    "Ethics & Governance": {"ethics","accountability","transparency","regulation","law","policy","bias","responsibility"},
    "Agricultural Technology": {"agritech","precisionfarming","drone","sensor","cropmonitoring","soil","yield"},
    "Medical Imaging": {"radiology","ctscan","mri","xray","ultrasound","imageanalysis","segmentation"},
    "Smart Wearables": {"wearable","smartwatch","fitbit","tracker","sensor","biometric","heartrate","fitnessband"},
    "Climate Tech": {"carboncapture","renewable","greenenergy","climatetech","emissionreduction","sustainability"},
    "Robotic Process Automation": {"rpa","automation","workflow","bot","taskautomation","process","uipath","blueprism"},
    "Defense & Aerospace": {"military","missile","radar","airforce","defense","weapon","drone","satellite","reconnaissance"},
    "Food Technology": {"foodtech","agriculture","nutrition","labgrown","protein","plantbased","sustainability"},
    "Mental Health": {"therapy","psychology","counseling","depression","anxiety","mindfulness","stress","wellbeing"},
    "Public Health": {"vaccine","epidemic","pandemic","disease","healthpolicy","infection","prevention"},
    "Disaster Management": {"crisis","disaster","rescue","emergencyresponse","flood","earthquake","fire"},
    "Sociology & Behavior": {"social","behavior","community","culture","ethnography","society","psychology"},
    "Econometrics": {"regression","modeling","econometrics","forecasting","macro","micro","economy"},
    "Philosophy & Ethics": {"philosophy","morality","ethics","logic","epistemology","reason","metaphysics"},
    "Transportation Systems": {"bus","metro","railway","transit","traffic","route","ticket","station"},
    "Finance Analytics": {"portfolio","trading","investment","risk","forecast","market","return","valuation"},
    "Blockchain Applications": {"token","crypto","wallet","smartcontract","blockchain","nft","defi","dapp"},
    "Data Privacy": {"gdpr","dataprivacy","encryption","consent","userdata","compliance","policy"},
    "Creative Design": {"graphicdesign","illustration","figma","adobe","photoshop","creativity","poster","branding"},
    "Photography & Videography": {"camera","dslr","lens","photography","cinematography","editing","video"},
    "Renewable Infrastructure": {"solarplant","windfarm","battery","grid","energytransition","renewables"},
    "Insurance Tech": {"insurtech","policy","claim","riskmodeling","underwriting","premium"},
    "Legal Tech": {"lawtech","contract","compliance","case","litigation","documentreview"},
    "AI in Education": {"edtech","learningplatform","personalizedlearning","student","teacher","curriculum"},
    "AI in Finance": {"fintech","frauddetection","credit","riskmodel","loan","investment","forecasting"},
    "Cognitive Science": {"neuroscience","perception","memory","learning","decisionmaking","mind"},
    "Knowledge Graphs": {"ontology","graphdb","semantic","triples","linkeddata","rdf","sparql"},
    "Data Visualization": {"dashboard","chart","plot","visualization","analytics","datastory","insight"},
    "Text Mining": {"nlp","sentiment","entityrecognition","topicmodeling","tokenization","textclassification"},
    "Infection Control Facilities": {"Isolation","suite","room","containment","controlled-area","isolation-unit","airlock","clinical-room","restricted-space"},
    "Accessible Movement Areas": {"Ambulant","space","users","mobility","circulation","accessible-route","movement-path","walkway","supports-mobility"},
    "Accessible Sanitary Facilities": {"Used","may","toilet","accessible-toilet","restroom","washroom","WC","hygiene-space","sanitary-cubicle"},
    "Handwashing Fixtures": {"Tap","lever","used","faucet","handle","water-control","sink","basin-fixture","activation-mechanism"},
    "Standing Work Zones": {"Staff","seats","without","standing-area","workstation","non-seated-zone","staff-point","observation-area","duty-station"},
    "External Ventilation Systems": {"Building","outside","fan","exhaust","HVAC","airflow","ventilation-unit","outdoor-equipment","air-extractor"},
    "Air-Pressure Transition Zones": {"Lobby","adjacent","pressure","anteroom","buffer-space","pressure-controlled-area","transition-room","regulated-air","sealed-entry"},
    "Touchdown Workpoints": {"Base","touchdown","standing","quick-stop-area","standing-point","short-stay-zone","counter","brief-workspace","leaning-space"},
    "Patient Interaction Areas": {"Bedside","communication","activity","patient-care","monitoring","clinical-interaction","dialogue","observation","care-activity"}
}


def _normalize_category_map(cmap: dict) -> dict:
    """lower-case + set-ify all entries once at module load."""
    norm = {}
    for label, words in (cmap or {}).items():
        if not words:
            continue
        norm[label] = set(w.strip().lower() for w in words if w and str(w).strip())
    return norm


# Computed once at module load - single source of truth
_CATEGORY_MAP_NORM = _normalize_category_map(category_map)


def auto_label_from_terms(top_terms, n=3):
    """
    Build a short readable label from the top terms, e.g. "Loan • bank • payment".
    Skips junky tokens (digits, very short, mostly non-alpha).

    Args:
        top_terms: list of [word, weight] pairs OR list of words
        n: max number of terms to include in the label

    Returns:
        Short label string. Falls back to "Topic" if no usable terms.
    """
    words = []
    for t in top_terms:
        w = t[0] if isinstance(t, (list, tuple)) else t
        w = str(w).strip().lower()
        if not w:
            continue
        if len(w) < 3:
            continue
        if re.search(r"\d", w):              # skip tokens with digits
            continue
        if not re.search(r"[a-z]", w):       # skip tokens without letters
            continue
        w = w.replace("_", " ")[:20]
        words.append(w)
        if len(words) >= n:
            break

    if not words:
        return "Topic"
    words[0] = words[0].capitalize()
    return " • ".join(words)


def best_label_for_terms(top_terms, default_label=None, min_hits=2, min_score=0.0):
    """
    Pick a label from category_map if there is sufficient overlap.

    Args:
        top_terms: list of [word, weight] pairs OR list of words
        default_label: fallback label to return when no category matches
        min_hits: require at least this many category words to match
        min_score: optional weight threshold (kept 0.0 by default)

    Returns:
        Best-matching category label, or default_label if no match.
    """
    if not top_terms:
        return default_label or "Topic"

    # Normalize {word: weight}
    weights = defaultdict(float)
    for t in top_terms:
        if isinstance(t, (list, tuple)) and len(t) >= 1:
            w = str(t[0]).lower()
            wt = float(t[1]) if len(t) >= 2 and isinstance(t[1], (int, float)) else 1.0
        else:
            w = str(t).lower()
            wt = 1.0
        weights[w] += wt

    best_label, best_score, best_hits = None, 0.0, 0
    for label, vocab in _CATEGORY_MAP_NORM.items():
        hits = 0
        score = 0.0
        for w in vocab:
            if w in weights:
                hits += 1
                score += weights[w]
        if score > best_score:
            best_label, best_score, best_hits = label, score, hits

    if best_label and best_hits >= min_hits and best_score > min_score:
        return best_label

    return default_label or "Topic"


# Backward-compat aliases (old code uses _best_label_for_terms / _auto_label_from_terms)
_best_label_for_terms = best_label_for_terms
_auto_label_from_terms = auto_label_from_terms