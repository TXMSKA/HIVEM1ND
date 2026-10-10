const COPY = {
  loading: ["Loading.", "Cargando."],
  loadingView: ["Reading the mind.", "Leyendo la mente."],
  reopenTitle: ["Open HIVEM1ND again", "Abrir HIVEM1ND de nuevo"],
  reopenBody: ["This page no longer has a session.", "Esta página ya no tiene una sesión."],
  homePrompt: ["Enter the home code on this device.", "Introducir el código de casa en este dispositivo."],
  map: ["Map", "Mapa"],
  hierarchy: ["Hierarchy", "Jerarquía"],
  chats: ["Chats", "Chats"],
  waiting: ["Waiting", "Pendientes"],
  blueprint: ["Blueprint", "Blueprint"],
  document: ["Document", "Documento"],
  focus: ["Focus", "Concentración"],
  settings: ["Settings", "Configuración"],
  approve: ["Approve", "Aprobar"],
  approveAlways: ["Approve always", "Aprobar siempre"],
  deny: ["Deny", "Denegar"],
  accept: ["Accept", "Aceptar"],
  sendBack: ["Send back", "Devolver"],
  watch: ["Watch", "Seguir"],
  highContrast: ["High contrast", "Alto contraste"],
  cancel: ["Cancel", "Cancelar"],
  close: ["Close", "Cerrar"],
  retry: ["Retry", "Reintentar"],
  showMore: ["Show {count} more", "Mostrar {count} más"],
  statusUnknown: ["Unknown", "Desconocido"],
  statusOut: ["Out", "Fuera"],
  statusQuota: ["Quota", "Cupo"],
  statusWaiting: ["Waiting", "En espera"],
  statusWorking: ["Working", "Trabajando"],
  statusIdle: ["Idle", "Inactivo"],
  queued: ["The notice is queued. A reply has not been recorded.", "El aviso está en cola. No hay una respuesta registrada."],
  submitted: ["The notice was submitted. A reply has not been recorded.", "El aviso fue enviado. No hay una respuesta registrada."],
  ambiguous: ["The destination is ambiguous. Nothing was delivered.", "El destino es ambiguo. No se entregó nada."],
  failed: ["The notice failed. Nothing was delivered.", "El aviso falló. No se entregó nada."],
  emptyInspector: ["Select a unit to see its details.", "Seleccionar una unidad para ver sus detalles."],
  emptyList: ["Nothing to show.", "No hay nada para mostrar."],
  outsideChange: ["This document changed elsewhere. The draft is still here.", "Este documento cambió en otro lugar. El borrador sigue aquí."],
  unavailable: ["The service is unavailable.", "El servicio no está disponible."],
  offline: ["This machine is offline.", "Esta máquina está desconectada."],
  confirmAction: ["Confirm this action.", "Confirmar esta acción."],
  confirmConnect: ["{member} will report to {lead}.", "{member} reportará a {lead}."],
  sessionExpired: ["This session ended. Open HIVEM1ND again.", "Esta sesión terminó. Abrir HIVEM1ND de nuevo."],
  homeExpired: ["Home access expired.", "El acceso de casa expiró."],
  phoneReadOnly: ["The phone cannot change this.", "El teléfono no puede cambiar esto."],
  forbidden: ["This action is not available.", "Esta acción no está disponible."],
  later: ["This screen is not ready yet.", "Esta pantalla todavía no está lista."],
  viewTooLarge: ["The mind is too large to load at once.", "La mente es demasiado grande para cargarla de una vez."],
  unitCount: ["{count} units", "{count} unidades"],
  waitingCount: ["{count} waiting", "{count} pendientes"],
  unreadCount: ["{count} unread", "{count} sin leer"],
  issueCount: ["{count} issues", "{count} incidencias"],
  lastRead: ["Last read {time}", "Última lectura {time}"],
  syncLocal: ["Saved on this machine", "Guardado en esta máquina"],
  syncPending: ["Waiting to publish", "En espera de publicación"],
  syncPublished: ["Published", "Publicado"],
  syncError: ["Sync needs attention", "La sincronización necesita atención"],
  serviceRunning: ["Service on {machine}", "Servicio en {machine}"],
  openInspector: ["Open details", "Abrir detalles"],
  closeInspector: ["Close details", "Cerrar detalles"],
  summaryTitle: ["Snapshot", "Instantánea"],
  issuesTitle: ["Issues", "Incidencias"],
  search: ["Search", "Buscar"],
  command: ["Chain of command", "Cadena de mando"],
  withoutOverlord: ["Without an Overlord", "Sin un Overlord"],
  services: ["Services", "Servicios"],
  scopeRoot: ["Root", "Raíz"],
  listError: ["The list could not be loaded.", "No se pudo cargar la lista."],
  cycleIssue: ["A reporting cycle was found.", "Se encontró un ciclo de reporte."],
  loadingList: ["Loading the list.", "Cargando la lista."],
  listTotal: ["{count} listed", "{count} en la lista"],
};

const DICTIONARIES = {
  en: Object.fromEntries(Object.entries(COPY).map(([key, value]) => [key, value[0]])),
  es: Object.fromEntries(Object.entries(COPY).map(([key, value]) => [key, value[1]])),
};

export function text(language, key, variables = {}) {
  const dictionary = DICTIONARIES[language] ?? DICTIONARIES.en;
  if (!Object.hasOwn(dictionary, key)) throw new Error(`Unknown copy key: ${key}`);
  return dictionary[key].replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? ""));
}

export function dictionaryKeys() {
  return Object.keys(DICTIONARIES.en);
}

export { DICTIONARIES };
