import { Container } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

function compactEnv(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
  );
}

export class RpgContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";

  // Os segredos ficam no Worker e são repassados somente ao processo Node.
  // Nada disso é enviado ao navegador.
  envVars = compactEnv({
    NODE_ENV: "production",
    PORT: "8080",
    DATABASE_URL: env.DATABASE_URL,
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,

    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_REALTIMEKIT_APP_ID: env.CLOUDFLARE_REALTIMEKIT_APP_ID,
    CLOUDFLARE_REALTIMEKIT_API_TOKEN: env.CLOUDFLARE_REALTIMEKIT_API_TOKEN,
    CLOUDFLARE_REALTIMEKIT_PRESET: env.CLOUDFLARE_REALTIMEKIT_PRESET,
    CLOUDFLARE_REALTIMEKIT_HOST_PRESET: env.CLOUDFLARE_REALTIMEKIT_HOST_PRESET,
    CLOUDFLARE_REALTIMEKIT_PLAYER_PRESET: env.CLOUDFLARE_REALTIMEKIT_PLAYER_PRESET,

    V6_APPROVAL_EMAIL: env.V6_APPROVAL_EMAIL,
    SMTP_HOST: env.SMTP_HOST,
    SMTP_PORT: env.SMTP_PORT,
    SMTP_SECURE: env.SMTP_SECURE,
    SMTP_USER: env.SMTP_USER,
    SMTP_PASS: env.SMTP_PASS,

    // Mantidos apenas para o fallback WebRTC P2P.
    TURN_URL: env.TURN_URL,
    TURN_USERNAME: env.TURN_USERNAME,
    TURN_CREDENTIAL: env.TURN_CREDENTIAL
  });

  onStart() {
    console.log("Mesa RPG Online: container Node iniciado.");
  }

  onError(error) {
    console.error("Mesa RPG Online: erro no container:", error);
  }
}

export default {
  async fetch(request, workerEnv) {
    // Uma única instância é proposital nesta etapa: o Socket.IO atual mantém
    // participantes e estado transitório em memória. Isso evita dividir uma
    // mesma sala entre processos diferentes durante a migração.
    const container = workerEnv.RPG_CONTAINER.getByName("mesa-rpg-singleton");
    return container.fetch(request);
  }
};
