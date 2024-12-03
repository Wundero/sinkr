"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api } from "~/trpc/react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { Input } from "./ui/input";

const addAppSchema = z.object({
  name: z.string().min(1).max(64),
});

export function AddAppButton() {
  const form = useForm<z.infer<typeof addAppSchema>>({
    resolver: zodResolver(addAppSchema),
    defaultValues: {
      name: "Example app",
    },
  });

  const utils = api.useUtils();
  const addAppMutation = api.main.createApp.useMutation({
    onSuccess: () => {
      void utils.main.listApps.invalidate();
    },
  });

  const [open, setOpen] = useState(false);

  const onSubmit = (values: z.infer<typeof addAppSchema>) => {
    addAppMutation.mutate(values);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          <span className="sr-only">Add Application</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add application</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>App Name</FormLabel>
                  <FormControl>
                    <Input placeholder="my-sinkr-app" {...field} />
                  </FormControl>
                  <FormDescription>
                    This is your public display name.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                variant={"outline"}
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  form.reset();
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Create App</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
