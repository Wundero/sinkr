"use client";

import type { Session } from "next-auth";
import { useMemo } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

function SignInButton() {
  return <Button onClick={() => signIn("github")}>Sign in</Button>;
}

function UserProfile({ session }: { session: Session }) {
  const userTwoCharacters = useMemo(() => {
    return (session.user.name ?? "AN").slice(0, 2).toUpperCase();
  }, [session]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Avatar>
          <AvatarImage src={session.user.image ?? ""} />
          <AvatarFallback>{userTwoCharacters}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{session.user.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserButton() {
  const session = useSession();

  if (!session.data) {
    return <SignInButton />;
  }
  return <UserProfile session={session.data} />;
}
