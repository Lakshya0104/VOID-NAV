"""VOID-NAV SOS understanding model (pure Python, no dependencies).

A small multilingual text classifier that reads what a survivor types (English, Hinglish, Telugu or
Hindi, transliterated or native script) and predicts the triage fields that SemCode packs into 5 bytes:

    category (9 classes)              multinomial Naive Bayes
    injured, bleeding, unconscious    binary Naive Bayes, one per flag
    needs  (8 flags)                  binary Naive Bayes, one per flag
    vulnerable people (4 flags)       binary Naive Bayes, one per flag
    position (7 classes)              multinomial Naive Bayes
    people count                      number / number-word extraction

Features are word unigrams + bigrams plus a multilingual root-word lexicon ("phas", "chikk", "khoon",
"rakt", native-script stems), so transliterated and native-script messages share evidence.
(Character n-grams were tried and dropped: they memorised phrasings and hurt held-out accuracy.)

Train:  python ai/sos_ai.py train      -> ai/sos_model.json (+ prints held-out accuracy)
Use:    from ai.sos_ai import SOSModel; SOSModel.load().predict("leg stuck, mother bleeding")
"""
import json, math, os, re, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "sos_model.json")
CATS = ["TRAPPED", "MEDICAL", "FIRE", "FLOOD", "COLLAPSE", "FOOD_WATER", "SHELTER", "SAFE", "OTHER"]
POS = ["UNKNOWN", "GROUND", "UPPER_FLOOR", "BASEMENT", "ROOF", "OUTSIDE", "VEHICLE"]
FLAGS = ["injured", "bleeding", "unconscious"]
NEEDS = ["MEDICAL", "WATER", "FOOD", "EVACUATION", "SHELTER", "RESCUE_TOOLS", "MEDICINE", "LIGHT"]
VULN = ["CHILD", "ELDERLY", "PREGNANT", "DISABLED"]
NUMW = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "che": 6, "saat": 7,
        "okati": 1, "rendu": 2, "moodu": 3, "mudu": 3, "naalugu": 4, "nalugu": 4, "aidu": 5, "aaru": 6,
        "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "ఒకటి": 1, "రెండు": 2, "మూడు": 3, "నాలుగు": 4, "ఐదు": 5}


# multilingual root-word lexicon: matched stems become extra features; the model learns their weight
LEX = {
    "TRAP": ["trap", "stuck", "pinned", "jammed", "cant get out", "can't get out", "locked in", "phas", "phans", "fans", "chikk", "irukk", "band ho", "bayataki raa", "nahi nikal", "फंस", "చిక్కు", "బయటకు రా"],
    "COLL": ["collaps", "fell", "fall", "caved", "came down", "gir ", "gira", "giri", "kool", "kulip", "crack", "tilt", "leaning", "गिर", "కూలి", "ceiling", "pillar"],
    "MED": ["doctor", "heart", "seizure", "fits", "breath", "saans", "oopiri", "asthma", "fever", "vomit", "insulin", "sugar", "diabet", "bp ", "pain", "dard", "labour", "labor", "ambulance", "hospital", "डॉक्टर", "డాక్టర్", "सांस", "ఊపిరి"],
    "FIRE": ["fire", "smoke", "flame", "burn", "gas", "cylinder", "spark", "aag", "dhua", "dhuan", "mant", "pogal", "आग", "धुआ", "మంట", "పొగ"],
    "FLOOD": ["flood", "water entering", "water rising", "water up", "water till", "submerg", "overflow", "paani bhar", "pani bhar", "pani ghar", "neellu vach", "neeru", "varad", "rising", "बाढ़", "నీళ్ళు వచ్చ", "badh raha"],
    "FOODW": ["food", "hungry", "khana", "bhookh", "annam", "thina", "milk", "drinking water", "peene", "thaaga", "tagad", "खाना", "ఆహారం", "తాగ"],
    "SHELT": ["shelter", "tent", "blanket", "kambal", "sleeping on", "no roof", "place to stay", "rehne", "undataniki", "chotu ledu", "road meeda", "रहने", "ఉండటానికి", "దుప్పటి"],
    "SAFE": ["safe", "fine", "ok ", "theek", "surakshit", "baagun", "kshem", "सुरक्षित", "క్షేమ", "no injur", "koi chot nahi", "relief camp", "emi kaaledu"],
    "OTHER": ["missing", "looking for", "lost my", "where is", "information", "pata nahi", "kanipinch", "helpline", "charge", "power bank", "मिल नहीं"],
    "INJ": ["injur", "hurt", "broken", "fractur", "cant walk", "cannot walk", "crush", "chot", "toot", "debba", "virig", "gaaya", "gaay", "घायल", "గాయ", "can't move", "cant move", "cannot move"],
    "BLD": ["bleed", "blood", "khoon", "khun", "rakt", "रक्त", "खून", "రక్త"],
    "UNC": ["unconscious", "faint", "not respond", "passed out", "not waking", "behosh", "spruha", "बेहोश", "స్పృహ"],
    "CHILD": ["child", "kid", "baby", "infant", "bachch", "bachcha", "pillal", "bidda", "బిడ్డ", "बच्च", "పిల్ల", "son ", "daughter"],
    "OLD": ["old", "elder", "grand", "dadi", "dada", "nani", "ammamma", "thatha", "bamma", "बुजुर्ग", "బామ్మ", "aged", "mother", "father", "amma", "maa ", "माँ"],
    "PREG": ["pregnan", "garbh", "expecting", "labour", "गर्भ", "గర్భ"],
    "DIS": ["disabled", "wheelchair", "blind", "deaf", "viklang", "vikalang", "दिव्यांग", "विकलांग", "దివ్యాంగ"],
    "WATER": ["water", "paani", "pani", "neellu", "thirst", "पानी", "నీళ్ళ"],
    "LIGHT": ["torch", "dark", "light", "andher", "cheekat", "अंधेरा", "చీకటి", "power gone"],
    "TOOLS": ["cutter", "jcb", "crane", "rope", "ladder", "hammer", "break wall", "हथौड़ा"],
    "MEDS": ["insulin", "tablet", "medicine", "dawai", "mandul", "inhaler", "दवा", "మందు"],
    "EVAC": ["evacuat", "take us out", "nikalo", "teesukell", "boat", "निकालो"],
    "POS_B": ["basement", "cellar", "tehkhan", "underground", "तहखा", "సెల్లార్"], "POS_R": ["roof", "terrace", "chhat", "rooftop", "छत", "డాబా"],
    "POS_U": ["floor", "manzil", "anthast", "मंजिल", "అంతస్తు", "flat", "stairs"], "POS_G": ["ground"], "POS_O": ["road", "outside", "bahar", "street", "bus stop", "temple", "सड़क"],
    "POS_V": ["car", "bus", "auto", "gaadi", "van", "vehicle", "lift", "गाड़ी", "కారు"],
}


def tokens(text):
    t = text.lower()
    words = re.findall(r"[\wऀ-ॿఀ-౿]+", t)
    feats = list(words)
    feats += [a + "_" + b for a, b in zip(words, words[1:])]
    pad = " " + t + " "
    for k, stems in LEX.items():
        if any(s in pad for s in stems):
            feats += ["LEX_" + k] * 15
    return feats


class NB:
    """Multinomial Naive Bayes with add-alpha smoothing."""
    def __init__(self, alpha=0.3):
        self.alpha, self.cls, self.prior, self.cnt, self.tot, self.vocab = alpha, [], {}, {}, {}, set()

    def fit(self, X, y):
        self.cls = sorted(set(y))
        n = Counter(y)
        self.prior = {c: math.log(n[c] / len(y)) for c in self.cls}
        self.cnt = {c: defaultdict(int) for c in self.cls}
        for f, c in zip(X, y):
            for t in f:
                self.cnt[c][t] += 1; self.vocab.add(t)
        self.tot = {c: sum(self.cnt[c].values()) for c in self.cls}
        return self

    def scores(self, f):
        V = len(self.vocab)
        out = {}
        for c in self.cls:
            s, cc, d = self.prior[c], self.cnt[c], self.tot[c] + self.alpha * V
            for t in f:
                if t in self.vocab:
                    s += math.log((cc.get(t, 0) + self.alpha) / d)
            out[c] = s
        m = max(out.values()); z = sum(math.exp(v - m) for v in out.values())
        return {c: math.exp(v - m) / z for c, v in out.items()}

    def dump(self):
        return {"alpha": self.alpha, "cls": self.cls, "prior": self.prior, "cnt": {c: dict(v) for c, v in self.cnt.items()}}

    @classmethod
    def load(cls, d):
        m = cls(d["alpha"]); m.cls = d["cls"]; m.prior = d["prior"]; m.cnt = d["cnt"]
        m.tot = {c: sum(v.values()) for c, v in m.cnt.items()}; m.vocab = set().union(*[set(v) for v in m.cnt.values()])
        return m


def people_count(text):
    t = text.lower()
    m = re.findall(r"\b(\d{1,2})\s*(?:people|persons|members|of us|log|mandi|manam|jan|logon|ppl|family)", t)
    if m: return int(m[0])
    m = re.findall(r"(?:we are|we r|hum|memu|maamu|total)\s*(\d{1,2})\b", t)
    if m: return int(m[0])
    for w, n in NUMW.items():
        if re.search(r"(?:^|\W)" + re.escape(w) + r"(?:\W|$)", t) and re.search(r"people|of us|log|mandi|members|jan|ppl|family|లో|मंदि|लोग|మంది", t):
            return n
    return None


class SOSModel:
    def __init__(self, models, meta):
        self.m, self.meta = models, meta

    @classmethod
    def load(cls, path=MODEL_PATH):
        d = json.load(open(path, encoding="utf-8"))
        return cls({k: NB.load(v) for k, v in d["models"].items()}, d["meta"])

    def predict(self, text):
        f = tokens(text or "")
        if not f:
            return None
        cat = self.m["cat"].scores(f); pos = self.m["pos"].scores(f)
        flag = {k: self.m["flag_" + k].scores(f).get("1", 0.0) for k in FLAGS}
        need = {k: self.m["need_" + k].scores(f).get("1", 0.0) for k in NEEDS}
        vuln = {k: self.m["vuln_" + k].scores(f).get("1", 0.0) for k in VULN}
        best = max(cat, key=cat.get); bpos = max(pos, key=pos.get)
        # evidence: the words that pushed the chosen category most (for the on-screen explanation)
        nb = self.m["cat"]; V = len(nb.vocab); ev = []
        for w in set(re.findall(r"[\wऀ-ॿఀ-౿]+", text.lower())):
            if w in nb.vocab:
                lift = math.log((nb.cnt[best].get(w, 0) + nb.alpha) / (nb.tot[best] + nb.alpha * V)) - \
                       max(math.log((nb.cnt[c].get(w, 0) + nb.alpha) / (nb.tot[c] + nb.alpha * V)) for c in nb.cls if c != best)
                if lift > 0.7: ev.append((w, round(lift, 2)))
        ev.sort(key=lambda x: -x[1])
        return {"cat": best, "cat_conf": round(cat[best], 3), "cat_top": sorted(((c, round(p, 3)) for c, p in cat.items()), key=lambda x: -x[1])[:3],
                "pos": bpos if pos[bpos] > 0.5 else "UNKNOWN", "pos_conf": round(pos[bpos], 3),
                "flags": {k: round(v, 3) for k, v in flag.items()}, "needs": {k: round(v, 3) for k, v in need.items()},
                "vuln": {k: round(v, 3) for k, v in vuln.items()}, "people": people_count(text), "evidence": ev[:6]}


# ---------------------------------------------------------------- training
def train(out=MODEL_PATH):
    sys.path.insert(0, HERE)
    from sos_data import generate, HANDWRITTEN
    train_rows, test_rows = generate(seed=1, n=4200), generate(seed=99, n=900, holdout=True)
    X = [tokens(r["text"]) for r in train_rows]
    models = {"cat": NB().fit(X, [r["cat"] for r in train_rows]), "pos": NB().fit(X, [r["pos"] for r in train_rows])}
    for k in FLAGS: models["flag_" + k] = NB().fit(X, ["1" if r[k] else "0" for r in train_rows])
    for k in NEEDS: models["need_" + k] = NB().fit(X, ["1" if k in r["needs"] else "0" for r in train_rows])
    for k in VULN: models["vuln_" + k] = NB().fit(X, ["1" if k in r["vuln"] else "0" for r in train_rows])
    m = SOSModel(models, {})

    def evaluate(rows):
        acc = Counter(); n = len(rows)
        for r in rows:
            p = m.predict(r["text"])
            acc["category"] += p["cat"] == r["cat"]
            acc["bleeding"] += (p["flags"]["bleeding"] > .5) == r["bleeding"]
            acc["injured"] += (p["flags"]["injured"] > .5) == r["injured"]
            acc["needs (all 8 flags exact)"] += all((p["needs"][k] > .5) == (k in r["needs"]) for k in NEEDS)
            acc["vulnerable (all 4 exact)"] += all((p["vuln"][k] > .5) == (k in r["vuln"]) for k in VULN)
            if r.get("people"): acc["_pn"] += 1; acc["people count"] += p["people"] == r["people"]
        res = {k: round(v / (acc["_pn"] if k == "people count" else n), 3) for k, v in acc.items() if not k.startswith("_")}
        return res
    held = evaluate(test_rows); hand = evaluate(HANDWRITTEN)
    meta = {"train_examples": len(train_rows), "heldout_examples": len(test_rows), "handwritten_examples": len(HANDWRITTEN),
            "heldout_accuracy": held, "handwritten_accuracy": hand,
            "features": "word 1-2 grams + multilingual root-word lexicon (LEX) features", "model": "Naive Bayes ensemble (1 multiclass category, 1 position, 15 binary flags)",
            "data": "synthetic SOS messages from templates in English, Hinglish, Telugu-English, Hindi and Telugu script; held-out set uses unseen templates and fillers"}
    json.dump({"meta": meta, "models": {k: v.dump() for k, v in models.items()}}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print(json.dumps(meta, indent=1, ensure_ascii=False))
    print("model size", round(os.path.getsize(out) / 1024), "KB")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "train":
        train()
    else:
        m = SOSModel.load()
        for t in sys.argv[1:] or ["leg stuck under slab, my mother is bleeding, 3 of us in basement, need water"]:
            print(json.dumps(m.predict(t), ensure_ascii=False, indent=1))
