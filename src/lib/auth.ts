import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { getOrCreateParent, normalizePhone, processPendingInvites } from "./account-manager";

export const authOptions: NextAuthOptions = {
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    CredentialsProvider({
      name: "Phone",
      credentials: {
        phone: { label: "Phone", type: "tel" },
        name: { label: "Name", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.phone) return null;

        const phone = normalizePhone(credentials.phone);
        const parent = getOrCreateParent(phone, credentials.name || undefined);

        // Auto-accept any pending co-parent invites
        processPendingInvites(parent.id, phone);

        return {
          id: parent.id,
          name: parent.name || phone,
          email: phone, // NextAuth expects email, we use phone
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.phone = user.email; // phone stored as email
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.userId;
        (session.user as any).phone = token.phone;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET || "dev-secret-change-in-production",
};
