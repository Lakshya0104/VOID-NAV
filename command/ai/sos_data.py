"""Training data for the VOID-NAV SOS model.

Messages are composed from phrase banks (English, Hinglish, Telugu-English, Hindi and Telugu script).
Every bank is split: ~70% of phrasings are used for training, the rest ONLY for the held-out test,
so the reported accuracy is on wording the model never saw. HANDWRITTEN holds natural messages
written and labelled by hand, none generated from the banks.
"""
import random

CAT = {
    "TRAPPED": ["trapped under debris", "stuck under the slab", "we are trapped inside", "cant get out door jammed", "stuck in the rubble",
                "hum phas gaye hai", "malbe ke neeche phase hai", "bahar nahi nikal sakte", "memu chikkukunnam", "lopala irukkupoyam",
                "शिथिलाल కింద చిక్కుకున్నాం", "हम मलबे में फंसे हैं", "pinned under a wall", "door blocked we are locked in", "cannot move wall fell on us",
                "trapped in the staircase", "stairs collapsed cant get down", "ghar ke andar band ho gaye", "bayataki raalekapotunnam", "stuck between beams"],
    "COLLAPSE": ["building collapsed", "our house fell down", "roof caved in", "the apartment came down", "wall collapsed on the street",
                 "ghar gir gaya", "building gir gayi", "illu koolipoyindi", "building kulipoyindi", "मकान गिर गया", "భవనం కూలిపోయింది",
                 "whole block collapsed", "ceiling fell", "pillar broke building tilting", "chhat gir gayi", "goda koolindi", "cracks everywhere building leaning"],
    "MEDICAL": ["need a doctor urgently", "heart attack please help", "she is having a seizure", "diabetic patient no insulin", "difficulty breathing",
                "saans nahi le pa rahe", "doctor chahiye jaldi", "doctor kavali", "oopiri aadatledu", "डॉक्टर चाहिए", "డాక్టర్ కావాలి",
                "asthma attack inhaler finished", "high fever and vomiting", "pregnant woman in labour", "bp patient collapsed", "chest pain since an hour",
                "pet mein dard bahut", "sugar patient spruha ledu", "fits vachayi"],
    "FIRE": ["fire in the building", "smoke everywhere", "gas cylinder burst fire", "flames on the second floor", "kitchen on fire",
             "aag lag gayi", "dhuan bhar gaya", "mantalu vachayi", "fire vachindi", "आग लग गई", "మంటలు అంటుకున్నాయి",
             "short circuit sparks and fire", "burning smell and smoke", "gas leak smell strong", "cylinder se aag", "pogalu nindipoyayi"],
    "FLOOD": ["water entering the house", "flood water rising", "water up to our chest", "ground floor is flooded", "stranded on terrace water everywhere",
              "paani bhar gaya", "pani ghar mein ghus gaya", "neellu vachesayi", "varada neeru", "बाढ़ का पानी", "ఇంట్లోకి నీళ్ళు వచ్చాయి",
              "nala overflowing into homes", "road submerged car stuck in water", "water level increasing fast", "basement full of water", "neellu peruguthunnayi"],
    "FOOD_WATER": ["no food since yesterday", "drinking water finished", "children are hungry", "need food packets", "no clean water",
                   "khana nahi hai", "peene ka paani khatam", "annam ledu", "thinadaniki emi ledu", "खाना नहीं है", "తాగడానికి నీళ్ళు లేవు",
                   "milk for baby needed", "two days without food", "bhookh lagi hai sabko", "neellu ayipoyayi"],
    "SHELTER": ["house is gone need a place to stay", "sleeping on the road", "need tent and blankets", "no roof over us", "it is raining we have no shelter",
                "rehne ki jagah nahi", "chhat nahi hai", "undataniki chotu ledu", "rodda meeda unnam", "रहने की जगह नहीं", "ఉండటానికి చోటు లేదు",
                "need blankets cold night", "kids sleeping outside", "kambal chahiye"],
    "SAFE": ["we are safe", "all of us are fine", "we got out safely", "no injuries we are ok", "reached the relief camp",
             "hum surakshit hai", "sab theek hai", "memu safe ga unnam", "andaru baagunnaru", "हम सुरक्षित हैं", "మేము క్షేమంగా ఉన్నాం",
             "family is safe at school shelter", "everyone is ok just informing", "koi chot nahi"],
    "OTHER": ["my dog is missing", "lost my phone charger", "looking for my brother", "where is the relief camp", "need information",
              "bhai ka pata nahi", "relief camp ekkada", "maa amma kanipinchatledu", "मेरा भाई नहीं मिल रहा", "power bank kavali",
              "need to charge phone", "what is the helpline number"],
}
INJ = ["leg is broken", "head injury", "my arm is fractured", "badly hurt", "cannot walk", "chot lagi hai", "pair toot gaya", "debba tagilindi",
       "kaalu viragindi", "घायल है", "గాయపడ్డారు", "crushed hand", "back injury cant move", "hurt his neck"]
BLEED = ["bleeding a lot", "blood is not stopping", "deep cut bleeding", "khoon beh raha hai", "khoon nikal raha", "raktham kaarutondi",
         "raktam vastundi", "खून बह रहा है", "రక్తం కారుతోంది", "heavy bleeding from leg", "bleeding from head", "blood everywhere"]
UNCON = ["he is unconscious", "she fainted", "not responding", "behosh ho gaya", "spruha ledu", "बेहोश है", "స్పృహ లేదు", "not waking up", "passed out"]
POSB = {"GROUND": ["ground floor", "neeche wala floor", "kinda floor", "ground lo", "भूतल पर", "on the ground level"],
        "UPPER_FLOOR": ["second floor", "3rd floor", "upar wali manzil", "paina floor lo", "ऊपर की मंजिल", "రెండో అంతస్తు", "fourth floor flat"],
        "BASEMENT": ["in the basement", "cellar lo", "tehkhane mein", "parking basement", "तहखाने में", "సెల్లార్ లో", "underground parking"],
        "ROOF": ["on the roof", "on the terrace", "chhat par", "terrace meeda", "छत पर", "డాబా మీద", "rooftop"],
        "OUTSIDE": ["on the road outside", "near the temple", "in the open ground", "bahar sadak par", "road meeda", "सड़क पर", "near bus stop"],
        "VEHICLE": ["inside our car", "stuck in the bus", "auto lo unnam", "gaadi mein", "गाड़ी में", "కారు లో", "in a van"]}
VULB = {"CHILD": ["with my baby", "two small kids", "children with us", "bachche hai saath", "pillalu unnaru", "బిడ్డ తో", "बच्चे हैं", "infant with us"],
        "ELDERLY": ["my old mother", "grandfather is with us", "elderly couple", "dadi saath hai", "ammamma unnaru", "బామ్మ", "बुजुर्ग", "aged father"],
        "PREGNANT": ["my wife is pregnant", "pregnant lady here", "garbhvati hai", "garbhini", "గర్భిణీ", "गर्भवती", "expecting mother"],
        "DISABLED": ["wheelchair user", "my brother is disabled", "cannot see blind person", "viklang hai", "vikalangudu", "దివ్యాంగుడు", "विकलांग"]}
NEEDB = {"MEDICAL": ["need first aid", "need ambulance", "ambulance bhejo", "ambulance pampandi", "एम्बुलेंस", "అంబులెన్స్"],
         "WATER": ["need water", "paani chahiye", "neellu kavali", "पानी चाहिए", "నీళ్ళు కావాలి", "thirsty"],
         "FOOD": ["need food", "khana chahiye", "annam kavali", "खाना चाहिए", "ఆహారం కావాలి", "hungry"],
         "EVACUATION": ["please evacuate us", "take us out", "humein nikalo", "bayataki teesukellandi", "बाहर निकालो", "rescue boat needed"],
         "SHELTER": ["need blanket", "tent chahiye", "kappukovataniki kavali", "कंबल", "దుప్పటి"],
         "RESCUE_TOOLS": ["need cutter to break wall", "send jcb", "crane chahiye", "rope kavali", "हथौड़ा", "need a ladder"],
         "MEDICINE": ["need insulin", "bp tablets finished", "dawai chahiye", "mandulu kavali", "दवाई", "మందులు"],
         "LIGHT": ["no light it is dark", "need torch", "andhera hai", "cheekati ga undi", "अंधेरा", "చీకటి"]}
PPL = [("{n} people", None), ("{n} of us", None), ("we are {n}", None), ("hum {n} log", None), ("memu {n} mandi", None), ("{w} people here", "en"),
       ("total {n} members", None), ("{n} log phase hai", None), ("{n} mandi unnam", None)]
NUMWORD = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six"}
IMPLIED = {"TRAPPED": {"RESCUE_TOOLS"}, "COLLAPSE": {"RESCUE_TOOLS"}, "FIRE": {"EVACUATION"}, "FLOOD": {"EVACUATION"},
           "FOOD_WATER": {"FOOD", "WATER"}, "SHELTER": {"SHELTER"}, "MEDICAL": {"MEDICAL"}}


def split(lst, holdout, frac=0.7):
    k = max(1, int(len(lst) * frac))
    return lst[k:] if holdout and len(lst) > k else lst[:k]


def generate(seed=1, n=3000, holdout=False):
    R = random.Random(seed); rows = []
    S = lambda l: split(l, holdout)
    for _ in range(n):
        cat = R.choice(list(CAT)); parts = [R.choice(S(CAT[cat]))]
        r = {"cat": cat, "injured": False, "bleeding": False, "unconscious": False, "needs": set(IMPLIED.get(cat, set())), "vuln": set(), "pos": "UNKNOWN", "people": None}
        if cat not in ("SAFE", "OTHER"):
            if R.random() < .35: parts.append(R.choice(S(INJ))); r["injured"] = True
            if R.random() < .3: parts.append(R.choice(S(BLEED))); r["bleeding"] = True; r["injured"] = True
            if R.random() < .12: parts.append(R.choice(S(UNCON))); r["unconscious"] = True; r["injured"] = True
            if R.random() < .5: p = R.choice(list(POSB)); parts.append(R.choice(S(POSB[p]))); r["pos"] = p
            for v in VULB:
                if R.random() < .15: parts.append(R.choice(S(VULB[v]))); r["vuln"].add(v)
            for k in NEEDB:
                if R.random() < .14: parts.append(R.choice(S(NEEDB[k]))); r["needs"].add(k)
            if r["bleeding"] or r["unconscious"]: r["needs"].add("MEDICAL")
        if R.random() < .5:
            num = R.randint(2, 6); tpl, kind = R.choice(PPL)
            parts.append(tpl.format(n=num, w=NUMWORD[num])); r["people"] = num
        R.shuffle(parts)
        sep = R.choice([", ", " ", ". ", " - ", " and "])
        text = sep.join(parts)
        if R.random() < .3: text = text.lower()
        if R.random() < .15: text = text.replace("ing", "in").replace("ee", "e")      # typing noise
        if R.random() < .2: text = R.choice(["please help ", "sos ", "help ", "urgent ", "bachao ", "kapadandi "]) + text
        r["text"] = text; rows.append(r)
    return rows


def H(text, cat, injured=False, bleeding=False, unconscious=False, needs=(), vuln=(), pos="UNKNOWN", people=None):
    nd = set(IMPLIED.get(cat, set())) | set(needs)
    if bleeding or unconscious: nd.add("MEDICAL")
    return {"text": text, "cat": cat, "injured": injured or bleeding or unconscious, "bleeding": bleeding, "unconscious": unconscious,
            "needs": nd, "vuln": set(vuln), "pos": pos, "people": people}


HANDWRITTEN = [
    H("leg stuck under slab, my mother is bleeding, 3 of us in basement, need water", "TRAPPED", bleeding=True, needs={"WATER"}, vuln={"ELDERLY"}, pos="BASEMENT", people=3),
    H("Building came down on our street, my father cant move his legs", "COLLAPSE", injured=True, vuln={"ELDERLY"}),
    H("help we r stuck inside the lift, power gone", "TRAPPED", needs={"LIGHT"}),
    H("bhaiya hum 4 log phase hai, darwaza nahi khul raha", "TRAPPED", people=4),
    H("memu 5 mandi illu lo chikkukunnam, pillalu unnaru", "TRAPPED", vuln={"CHILD"}, people=5),
    H("smoke coming from the staircase, we are on the 4th floor", "FIRE", pos="UPPER_FLOOR"),
    H("gas leak hua hai aur aag lag gayi kitchen mein", "FIRE"),
    H("water till our knees and rising, old grandmother can't climb", "FLOOD", vuln={"ELDERLY"}),
    H("ma intlo neellu vachesayi, terrace meeda unnam", "FLOOD", pos="ROOF"),
    H("my husband had a heart attack, need ambulance now", "MEDICAL", needs={"MEDICAL"}),
    H("pregnant wife having pains, hospital ki teesukellali", "MEDICAL", vuln={"PREGNANT"}),
    H("sugar patient hai insulin khatam", "MEDICAL", needs={"MEDICINE"}),
    H("no food or water since morning, kids crying", "FOOD_WATER", vuln={"CHILD"}),
    H("thaagadaniki neellu levu, 2 days ayindi", "FOOD_WATER"),
    H("our house is gone, sleeping near the bus stop with family", "SHELTER", pos="OUTSIDE"),
    H("we are all safe at the school camp, just letting you know", "SAFE"),
    H("andaru baagunnaru, emi kaaledu", "SAFE"),
    H("looking for my sister Priya, last seen near market", "OTHER"),
    H("wall fell on my brother, he is not responding and bleeding from head", "TRAPPED", bleeding=True, unconscious=True),
    H("chhat gir gayi, dadi ke sar se khoon", "COLLAPSE", bleeding=True, vuln={"ELDERLY"}),
    H("trapped in car under the flyover, water entering", "TRAPPED", pos="VEHICLE"),
    H("fire in godown next door, smoke in our flat, baby with us", "FIRE", vuln={"CHILD"}),
    H("cannot breathe properly, asthma, inhaler finished", "MEDICAL", needs={"MEDICINE"}),
    H("3 people stuck on 2nd floor stairs broken", "TRAPPED", pos="UPPER_FLOOR", people=3),
    H("मेरी माँ मलबे में फंसी है, खून बह रहा है", "TRAPPED", bleeding=True, vuln={"ELDERLY"}),
    H("మా అమ్మ కింద చిక్కుకుంది, గాయపడింది", "TRAPPED", injured=True, vuln={"ELDERLY"}),
    H("pani bahut tez badh raha hai, chhat pe hai sab", "FLOOD", pos="ROOF"),
    H("need tents, 6 families on the road, raining", "SHELTER", pos="OUTSIDE"),
    H("the old building next to masjid collapsed people inside", "COLLAPSE"),
    H("my son fainted, no doctor here", "MEDICAL", unconscious=True),
]
