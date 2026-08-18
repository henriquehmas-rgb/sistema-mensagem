/**
 * Nome do cookie-sinalizador de sessão (sem valor sensível — apenas flag "1").
 * Usado pelo middleware para redirecionar visitantes não autenticados; a
 * autenticação real (tokens JWT) vive no auth store (localStorage) e é
 * validada pelo guard client-side + pela própria API.
 */
export const AUTH_COOKIE_NAME = "sm_authenticated";

export const APP_NAME = "SEEG Omni";
export const APP_TAGLINE =
  "Todas as conversas da sua operação — WhatsApp, Instagram e Webchat — em uma única inbox com IA.";
