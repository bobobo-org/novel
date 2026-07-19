import type { Metadata } from "next";
import CreateProjectClient from "./create-project-client";

export const metadata: Metadata = { title: "建立新作品｜諸天萬界小說生成系統" };

export default function CreateProjectPage() { return <CreateProjectClient />; }
