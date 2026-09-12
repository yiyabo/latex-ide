import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(80).optional(),
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const email = body.email.toLowerCase();
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return Response.json({ error: "Email already registered" }, { status: 409 });
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await db.user.create({
      data: { email, name: body.name || email.split("@")[0], passwordHash },
    });
    return Response.json({ id: user.id, email: user.email });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: err.errors[0]?.message }, { status: 400 });
    }
    console.error(err);
    return Response.json({ error: "Registration failed" }, { status: 500 });
  }
}
