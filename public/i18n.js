const I18N = {
  es: {
    subtitle: "A Coruña · 5–9 de agosto de 2026",
    month: "agosto",
    weekdays: {
      wednesday: "Miércoles",
      thursday: "Jueves",
      friday: "Viernes",
      saturday: "Sábado",
      sunday: "Domingo"
    },
    stages: "Escenarios",
    tbaTitle: "Por confirmar",
    tbaNote: "Estos actos todavía no tienen hora publicada.",
    noTimedActs: "Todavía no hay horarios confirmados para este día.",
    back: "Volver",
    stage: "Escenario",
    schedule: "Horario",
    day: "Día",
    timeTBA: "Hora por confirmar",
    spotifyBtn: "Buscar en Spotify",
    spotifyNote: "Enlace de búsqueda — el festival no publica el Spotify oficial de cada artista.",
    tapHint: "Toca un bloque para ver la ficha del artista",
    langBtn: "EN",

    gateTitle: "Festival Noroeste",
    gateSubtitle: "Inicia sesión, crea una cuenta o entra como invitado",
    usernameLabel: "Usuario",
    passwordLabel: "Contraseña",
    loginBtn: "Iniciar sesión",
    signupBtn: "Crear cuenta",
    guestBtn: "Entrar como invitado",
    toggleToSignup: "¿No tienes cuenta? Crea una",
    toggleToLogin: "¿Ya tienes cuenta? Inicia sesión",
    orDivider: "o",
    errUsernameLength: "El usuario debe tener entre 3 y 32 caracteres.",
    errPasswordLength: "La contraseña debe tener al menos 4 caracteres.",
    errUsernameTaken: "Ese usuario ya existe.",
    errInvalidCredentials: "Usuario o contraseña incorrectos.",
    errGeneric: "Algo ha fallado. Inténtalo de nuevo.",
    logout: "Cerrar sesión",
    guestLabel: "Invitado",
    favoritesOnlyBtn: "Solo favoritos",
    favoriteAdd: "Añadir a favoritos",
    favoriteRemove: "Quitar de favoritos"
  },
  en: {
    subtitle: "A Coruña · August 5–9, 2026",
    month: "August",
    weekdays: {
      wednesday: "Wednesday",
      thursday: "Thursday",
      friday: "Friday",
      saturday: "Saturday",
      sunday: "Sunday"
    },
    stages: "Stages",
    tbaTitle: "To be announced",
    tbaNote: "These acts don't have a published time yet.",
    noTimedActs: "No confirmed times for this day yet.",
    back: "Back",
    stage: "Stage",
    schedule: "Schedule",
    day: "Day",
    timeTBA: "Time TBA",
    spotifyBtn: "Search on Spotify",
    spotifyNote: "Search link — the festival doesn't publish each artist's official Spotify.",
    tapHint: "Tap a block to open the artist's page",
    langBtn: "ES",

    gateTitle: "Festival Noroeste",
    gateSubtitle: "Log in, create an account, or continue as a guest",
    usernameLabel: "Username",
    passwordLabel: "Password",
    loginBtn: "Log in",
    signupBtn: "Create account",
    guestBtn: "Continue as guest",
    toggleToSignup: "No account? Create one",
    toggleToLogin: "Already have an account? Log in",
    orDivider: "or",
    errUsernameLength: "Username must be 3–32 characters.",
    errPasswordLength: "Password must be at least 4 characters.",
    errUsernameTaken: "That username is already taken.",
    errInvalidCredentials: "Wrong username or password.",
    errGeneric: "Something went wrong. Please try again.",
    logout: "Log out",
    guestLabel: "Guest",
    favoritesOnlyBtn: "Favorites only",
    favoriteAdd: "Add to favorites",
    favoriteRemove: "Remove from favorites"
  }
};

function t(lang, path) {
  const parts = path.split(".");
  let node = I18N[lang];
  for (const p of parts) node = node[p];
  return node;
}
