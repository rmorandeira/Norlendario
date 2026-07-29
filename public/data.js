// Datos del cartel — Festival Noroeste Estrella Galicia 2026 (A Coruña)
// Fuente: https://festivalnoroesteestrellagalicia.com/calendario/
// Solo se publica hora de inicio; los actos marcados como tba aun no tienen hora confirmada ("Proximamente").

const FESTIVAL_DATA = {
  festivalName: "Festival Noroeste Estrella Galicia 2026",
  location: "A Coruña",
  stages: [
    "Azcárraga",
    "Campo da Leña",
    "Santa Margarida",
    "Castelo de Santo Antón",
    "Praza de María Pita",
    "Praia de Riazor",
    "O Portiño"
  ],
  days: [
    {
      id: "mie5",
      weekday: "wednesday",
      dateNum: 5,
      acts: [
        { artist: "LAW", stage: "Azcárraga", time: "13:00" },
        { artist: "David Regueiro Trío ft. Pablo Castaño", stage: "Azcárraga", time: "19:00" },
        { artist: "Pamela Rodríguez", stage: "Azcárraga", time: "22:00" },
        { artist: "Fantastic Negrito", stage: "Azcárraga", time: "00:00" },

        { artist: "Colorado", stage: "Campo da Leña", time: "14:00" },
        { artist: "Greasy Belly", stage: "Campo da Leña", time: "20:00" },
        { artist: "Agoraphobia", stage: "Campo da Leña", time: "23:00" },
        { artist: "Frankie & the Witch Fingers", stage: "Campo da Leña", time: "1:00" },

        { artist: "Freestyle People & Gallos del Norte", stage: "Santa Margarida", time: "19:00" },
        { artist: "Orquesta Invisible", stage: "Santa Margarida", time: "20:30" },
        { artist: "Catuxa Salom", stage: "Santa Margarida", time: "22:00" },
        { artist: "Bongeziwe Mabandla", stage: "Santa Margarida", time: "23:30" },

        { artist: "Anna Andreu", stage: "Castelo de Santo Antón", time: "21:00" },

        { artist: "Ángel Stanich", stage: "Praza de María Pita", time: "20:00" },
        { artist: "Dorian", stage: "Praza de María Pita", time: "22:00" },
        { artist: "Familia Caamagno e A Orquestra do Quince", stage: "Praza de María Pita", time: "00:00" }
      ]
    },
    {
      id: "jue6",
      weekday: "thursday",
      dateNum: 6,
      acts: [
        { artist: "Apolo18", stage: "Azcárraga", time: "13:00" },
        { artist: "MFC Chicken", stage: "Azcárraga", time: "19:00" },
        { artist: "La Perra Blanco", stage: "Azcárraga", time: "22:00" },
        { artist: "Moura", stage: "Azcárraga", time: "00:00" },

        { artist: "Mar de Fondo", stage: "Campo da Leña", time: "19:15" },
        { artist: "Meu", stage: "Campo da Leña", time: "20:30" },
        { artist: "Tsunami Arise", stage: "Campo da Leña", time: "23:00" },
        { artist: "Ruxe Ruxe", stage: "Campo da Leña", time: "1:00" },

        { artist: "Banda Diversidarte ft. Silvia Penide & La Sophie Simonds Band", stage: "Santa Margarida", time: "19:00" },
        { artist: "Mounqup", stage: "Santa Margarida", time: "20:30" },
        { artist: "Xosé Lois Romero & Aliboria", stage: "Santa Margarida", time: "22:00" },
        { artist: "Mari Froes", stage: "Santa Margarida", time: "23:30" },

        { artist: "Ana Lua Caiano", stage: "Castelo de Santo Antón", time: "21:00" },

        { artist: "Vicente Calderón", stage: "Praza de María Pita", time: "20:00" },
        { artist: "Yerai Cortés", stage: "Praza de María Pita", time: "22:00" }
      ]
    },
    {
      id: "vie7",
      weekday: "friday",
      dateNum: 7,
      acts: [
        { artist: "Crowded", stage: "Praia de Riazor", time: "20:00" },
        { artist: "Bala", stage: "Praia de Riazor", time: "21:00" },
        { artist: "Sprints", stage: "Praia de Riazor", time: "22:30" },
        { artist: "Rusowsky", stage: "Praia de Riazor", time: "00:30" },

        { artist: "DJMIL", stage: "O Portiño", tba: true }
      ]
    },
    {
      id: "sab8",
      weekday: "saturday",
      dateNum: 8,
      acts: [
        { artist: "Zënzar", stage: "Praia de Riazor", time: "20:00" },
        { artist: "Sés", stage: "Praia de Riazor", time: "21:00" },
        { artist: "Echo & the Bunnymen", stage: "Praia de Riazor", time: "23:00" },
        { artist: "Bomba Estéreo", stage: "Praia de Riazor", time: "1:00" },

        { artist: "Sofiperies", stage: "O Portiño", tba: true },
        { artist: "Saya DJ", stage: "O Portiño", tba: true }
      ]
    },
    {
      id: "dom9",
      weekday: "sunday",
      dateNum: 9,
      acts: [
        { artist: "Rey DJ / La Yaya DJ", stage: "O Portiño", tba: true },
        { artist: "Monkey Mambo Club", stage: "O Portiño", tba: true }
      ]
    }
  ]
};
