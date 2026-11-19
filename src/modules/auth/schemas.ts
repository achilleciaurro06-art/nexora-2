import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Email non valida").transform((v) => v.toLowerCase()),
  password: z.string().min(1, "Inserisci la password"),
});

const password = z.string().min(10, "Almeno 10 caratteri").max(128);

export const activationSchema = z.object({
  code: z.string().trim().min(6, "Codice non valido").max(64),
  email: z.email("Email non valida").transform((v) => v.toLowerCase()),
  fullName: z.string().trim().min(2, "Inserisci il tuo nome").max(120),
  orgName: z.string().trim().min(2, "Inserisci il nome dell'azienda").max(120),
  password,
});

export const invitationAcceptSchema = z.object({
  fullName: z.string().trim().min(2, "Inserisci il tuo nome").max(120),
  email: z.email("Email non valida").transform((v) => v.toLowerCase()),
  password,
});
