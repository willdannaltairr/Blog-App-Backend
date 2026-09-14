import { z } from "zod";

export const createBlogSchema = z.object({
  title: z.string().min(1, "Title wajib diisi").max(255, "Title maksimal 255 karakter"),
  content: z.string().min(1, "Content wajib diisi"),
  author: z.string().min(1, "Author wajib diisi").max(225, "Author maksimal 225 karakter"),
  category_id: z.coerce.number({ message: "Category wajib dipilih" }).int().positive("Category wajib dipilih"),
  category_ids: z.array(z.coerce.number().int().positive()).min(1, "Category wajib dipilih").optional(),
  image: z.string().max(255, "Image maksimal 255 karakter").optional().nullable(),
});

export const updateBlogSchema = z.object({
  title: z.string().min(1, "Title wajib diisi").max(255, "Title maksimal 255 karakter").optional(),
  content: z.string().min(1, "Content wajib diisi").optional(),
  author: z.string().min(1, "Author wajib diisi").max(225, "Author maksimal 225 karakter").optional(),
  category_id: z.coerce.number().int().positive().optional(),
  category_ids: z.array(z.coerce.number().int().positive()).min(1, "Category wajib dipilih").optional(),
  image: z.string().max(255, "Image maksimal 255 karakter").optional().nullable(),
});

export const createCategorySchema = z.object({
  name: z.string().min(1, "Nama kategori wajib diisi").max(100, "Maksimal 100 karakter"),
});

export const updateUserSchema = z.object({
  name: z.string().min(1, "Name wajib diisi").max(100, "Name maksimal 100 karakter").optional(),
  email: z.string().min(1, "Email wajib diisi").max(100, "Email maksimal 100 karakter").email("Email tidak valid").optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(1, "Name wajib diisi").max(100, "Name maksimal 100 karakter"),
  email: z.string().min(1, "Email wajib diisi").max(100, "Email maksimal 100 karakter").email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi").max(255, "Password maksimal 255 karakter"),
});

export const loginUserSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});
