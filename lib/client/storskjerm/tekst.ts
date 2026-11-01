// Tekster for storskjerm-mappa (bokmål). Lokal i mappa så den kan kopieres
// til andre Sunday-apper uten å dra med seg appens locale-fil.
export const tekst = {
  knapp: "Vis på storskjerm",
  tittel: "Vis på storskjerm",
  intro: "Visningen følger operatøren live. Den trenger ingen innlogging – bare adressen (eller den sekssifrede koden på stage.sundaysuite.app).",
  urlLabel: "Adresse til visningen",
  kopier: "Kopier",
  kopiert: "Kopiert",
  kopierFeilet: "Kunne ikke kopiere – merk adressen og kopier selv.",
  lukk: "Lukk",
  anbefalt: "Anbefalt for din enhet",
  direkte: {
    tittel: "TV eller PC med nettleser",
    hjelp: "Åpne adressen over i nettleseren på TV-en, eller på en PC koblet til projektoren med HDMI, og trykk F for fullskjerm. Alternativt: gå til stage.sundaysuite.app og skriv inn koden.",
  },
  eget: {
    tittel: "Åpne visningen i eget vindu",
    hjelp: "Du beholder operatørsiden her. Visningsvinduet kan flyttes til projektoren eller castes. Trykk F i vinduet for fullskjerm.",
    knapp: "Åpne visningen i eget vindu",
    flyttet: "Visningen ble flyttet til den andre skjermen. Trykk F for fullskjerm.",
    flyttHint: "Dra vinduet til projektoren eller TV-en og trykk F for fullskjerm.",
    blokkert: "Nettleseren blokkerte det nye vinduet. Tillat popup-vinduer for denne siden og prøv igjen.",
  },
  chromecast: {
    tittel: "Chromecast / Google TV",
    steg1: "Åpne visningen i eget vindu (knappen over).",
    steg2: "I Chrome-menyen ⋮ velger du «Cast …» (Lagre og del → Cast), og velger «Cast fane».",
    steg3: "Velg TV-en i listen. Trykk F i visningsvinduet for fullskjerm.",
    ikkeChromium: "Dette krever Chrome eller Edge på PC eller Chromebook. Åpne siden i en av dem for å caste.",
  },
  apple: {
    tittel: "Apple TV (AirPlay)",
    mac1: "Mac: åpne Kontrollsenter → Skjermspeiling og velg Apple TV.",
    mac2: "Velg «Bruk som separat skjerm».",
    mac3: "Åpne visningen i eget vindu (knappen over) og dra den over til Apple TV-en. Trykk F for fullskjerm.",
    ios1: "iPad/iPhone: åpne adressen i Safari, deretter Kontrollsenter → Skjermspeiling og velg Apple TV.",
    ios2: "Visningen fyller bildet av seg selv.",
  },
} as const;
