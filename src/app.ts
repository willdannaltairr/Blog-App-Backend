import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import "dotenv/config";
import pool from "./db/db.ts";
import {
  createBlogSchema,
  updateBlogSchema,
  createCategorySchema,
  createUserSchema,
  updateUserSchema,
  loginUserSchema,
} from "./validation/zod.ts";

const app = express();
const port = 8000;

app.use(cors());
app.use(express.json());

async function cekPassword(passwordAsli: string, passwordDB: string, userId: number) {
  if (!passwordDB) return false;

  if (passwordDB.startsWith("$2a$") || passwordDB.startsWith("$2b$")) {
    try {
      return await bcrypt.compare(passwordAsli, passwordDB);
    } catch {
      return false;
    }
  }

  if (passwordAsli === passwordDB) {
    try {
      const hash = await bcrypt.hash(passwordAsli, 10);
      await pool.query("UPDATE users SET password = ? WHERE id = ?", [hash, userId]);
    } catch {
    }
    return true;
  }

  return false;
}

async function simpanKategoriBlog(blogId: number, categoryIds: number[]) {
  const bersih: number[] = [];
  for (const id of categoryIds) {
    if (Number.isInteger(id) && id > 0 && !bersih.includes(id)) {
      bersih.push(id);
    }
  }

  await pool.query("DELETE FROM blog_categories WHERE blog_id = ?", [blogId]);
  if (bersih.length === 0) return;

  const values = bersih.map((id) => [blogId, id]);
  await pool.query("INSERT IGNORE INTO blog_categories (blog_id, category_id) VALUES ?", [values]);
}

async function lengkapkanKategori(blogs: any[]) {
  if (blogs.length === 0) return blogs;

  const blogIds = blogs.map((b) => b.id);
  const [relasi] = await pool.query(
    "SELECT bc.blog_id, c.id, c.name FROM blog_categories bc JOIN categories c ON c.id = bc.category_id WHERE bc.blog_id IN (?)",
    [blogIds]
  );

  const grup: Record<number, any[]> = {};
  for (const r of relasi as any[]) {
    if (!grup[r.blog_id]) grup[r.blog_id] = [];
    const sudahAda = grup[r.blog_id].some((c) => c.id === r.id);
    if (!sudahAda) grup[r.blog_id].push({ id: r.id, name: r.name });
  }

  const [semuaKategori] = await pool.query("SELECT id, name FROM categories");
  const namaKategori: Record<number, string> = {};
  for (const c of semuaKategori as any[]) {
    namaKategori[c.id] = c.name;
  }

  return blogs.map((b) => {
    const list = grup[b.id] || [];
    const lama = Number(b.category_id);
    if (lama > 0 && !list.some((c: any) => c.id === lama)) {
      list.unshift({ id: lama, name: namaKategori[lama] || "" });
    }
    return {
      ...b,
      category_ids: list.map((c: any) => c.id),
      categories: list,
    };
  });
}

app.get("/api/categories", async (_req: Request, res: Response) => {
  try {
    const [rows] = await pool.query("SELECT * FROM categories ORDER BY id ASC");
    res.status(200).json({
      message: "Berhasil mengambil semua categories",
      data: rows,
    });
  } catch {
    res.status(400).json({ message: "Gagal mengambil data categories" });
  }
});

app.post("/api/categories", async (req: Request, res: Response) => {
  try {
    const parsed = createCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: "Validasi gagal", errors });
    }

    const { name } = parsed.data;
    const [result] = await pool.query("INSERT INTO categories (name) VALUES (?)", [name]);

    res.status(201).json({
      message: "Category berhasil ditambahkan",
      data: { id: (result as any).insertId, name },
    });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Nama kategori sudah digunakan" });
    }
    res.status(400).json({ message: "Gagal menambahkan category" });
  }
});

app.get("/api/blogs", async (req: Request, res: Response) => {
  try {
    const { category_id, search } = req.query as { category_id?: string; search?: string };

    let sql = "SELECT * FROM blogs";
    const params: any[] = [];
    const where: string[] = [];

    if (category_id) {
      where.push(
        "(blogs.category_id = ? OR EXISTS (SELECT 1 FROM blog_categories bc WHERE bc.blog_id = blogs.id AND bc.category_id = ?))"
      );
      params.push(category_id, category_id);
    }

    if (search) {
      where.push("(title LIKE ? OR content LIKE ? OR author LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (where.length > 0) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY id DESC";

    const [rows] = await pool.query(sql, params);

    res.status(200).json({
      message: "Berhasil mengambil semua blogs",
      data: await lengkapkanKategori(rows as any[]),
    });
  } catch {
    res.status(400).json({ message: "Gagal mengambil data blogs" });
  }
});

app.get("/api/blogs/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query("SELECT * FROM blogs WHERE id = ?", [id]);
    const blogs = rows as any[];

    if (blogs.length === 0) {
      return res.status(404).json({ message: "Blog tidak ditemukan" });
    }

    const hasil = await lengkapkanKategori([blogs[0]]);
    res.status(200).json({
      message: "Berhasil mengambil blog",
      data: hasil[0],
    });
  } catch {
    res.status(400).json({ message: "Gagal mengambil data blog" });
  }
});

app.post("/api/blogs", async (req: Request, res: Response) => {
  try {
    const parsed = createBlogSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: "Validasi gagal", errors });
    }

    const { title, content, author, image, category_id, category_ids } = parsed.data;

    const [result] = await pool.query(
      "INSERT INTO blogs (category_id, title, content, author, image) VALUES (?, ?, ?, ?, ?)",
      [category_id, title, content, author, image ?? null]
    );
    const blogId = (result as any).insertId;
    await simpanKategoriBlog(blogId, [...(category_ids ?? []), category_id]);

    res.status(201).json({
      message: "Blog berhasil ditambahkan",
      data: { id: blogId },
    });
  } catch {
    res.status(400).json({ message: "Gagal menambahkan blog" });
  }
});

app.put("/api/blogs/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = updateBlogSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: "Validasi gagal", errors });
    }

    const data = parsed.data;
    const fields: string[] = [];
    const values: any[] = [];

    if (data.category_id !== undefined) {
      fields.push("category_id = ?");
      values.push(data.category_id);
    }
    if (data.title !== undefined) {
      fields.push("title = ?");
      values.push(data.title);
    }
    if (data.content !== undefined) {
      fields.push("content = ?");
      values.push(data.content);
    }
    if (data.author !== undefined) {
      fields.push("author = ?");
      values.push(data.author);
    }
    if (data.image !== undefined) {
      fields.push("image = ?");
      values.push(data.image);
    }

    if (fields.length === 0 && data.category_ids === undefined) {
      return res.status(400).json({ message: "Tidak ada data yang diupdate" });
    }

    if (fields.length > 0) {
      values.push(id);
      const [result] = await pool.query(`UPDATE blogs SET ${fields.join(", ")} WHERE id = ?`, values);
      if ((result as any).affectedRows === 0) {
        return res.status(404).json({ message: "Blog tidak ditemukan" });
      }
    } else {
      const [rows] = await pool.query("SELECT id FROM blogs WHERE id = ?", [id]);
      if ((rows as any[]).length === 0) {
        return res.status(404).json({ message: "Blog tidak ditemukan" });
      }
    }

    if (data.category_ids !== undefined) {
      await simpanKategoriBlog(Number(id), data.category_ids);
    } else if (data.category_id !== undefined) {
      await pool.query("INSERT IGNORE INTO blog_categories (blog_id, category_id) VALUES (?, ?)", [
        id,
        data.category_id,
      ]);
    }

    res.status(200).json({ message: "Blog berhasil diupdate" });
  } catch {
    res.status(400).json({ message: "Gagal mengupdate blog" });
  }
});

app.delete("/api/blogs/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM blog_categories WHERE blog_id = ?", [id]);
    const [result] = await pool.query("DELETE FROM blogs WHERE id = ?", [id]);

    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ message: "Blog tidak ditemukan" });
    }

    res.status(200).json({ message: "Blog berhasil dihapus" });
  } catch {
    res.status(400).json({ message: "Gagal menghapus blog" });
  }
});

// ---- USER & AUTH LAMA (biar aplikasi lama tetap jalan) ----

app.post("/api/users", async (req: Request, res: Response) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: "Validasi gagal", errors });
    }

    const { name, email, password } = parsed.data;
    const hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name, email, hash]);

    res.status(201).json({ message: "Registrasi berhasil" });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Email sudah terdaftar" });
    }
    res.status(400).json({ message: "Gagal menambahkan user" });
  }
});

app.post("/api/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: "Validasi gagal", errors });
    }

    const { email, password } = parsed.data;
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    const user = (rows as any[])[0];

    if (!user || !(await cekPassword(password, user.password, user.id))) {
      return res.status(401).json({ message: "Email atau password salah" });
    }

    const aman = { id: user.id, name: user.name, email: user.email };
    res.status(200).json({
      message: "Login berhasil",
      data: aman,
      user: aman,
    });
  } catch {
    res.status(400).json({ message: "Terjadi kesalahan saat login" });
  }
});

// ---- AUTH BARU ----

app.post("/api/auth/register", async (req: Request, res: Response) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: "Validasi gagal", errors });
    }

    const { name, email, password } = parsed.data;
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [
      name,
      email,
      hash,
    ]);

    const user = { id: (result as any).insertId, name, email };
    res.status(201).json({
      message: "Registrasi berhasil",
      data: user,
      user,
    });
  } catch (error: any) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Email sudah terdaftar" });
    }
    res.status(400).json({ message: "Gagal registrasi" });
  }
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: "Validasi gagal", errors });
    }

    const { email, password } = parsed.data;
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    const user = (rows as any[])[0];

    if (!user || !(await cekPassword(password, user.password, user.id))) {
      return res.status(401).json({ message: "Email atau password salah" });
    }

    const aman = { id: user.id, name: user.name, email: user.email };
    res.status(200).json({
      message: "Login berhasil",
      data: aman,
      user: aman,
    });
  } catch {
    res.status(400).json({ message: "Terjadi kesalahan saat login" });
  }
});

app.get("/api/auth/me", async (req: Request, res: Response) => {
  try {
    const id = Number((req.query as { id?: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Parameter id wajib diisi" });
    }

    const [rows] = await pool.query("SELECT id, name, email FROM users WHERE id = ?", [id]);
    const users = rows as any[];
    if (users.length === 0) {
      return res.status(404).json({ message: "User tidak ditemukan" });
    }

    res.status(200).json({ message: "Berhasil", data: users[0], user: users[0] });
  } catch {
    res.status(400).json({ message: "Gagal mengambil profil" });
  }
});

app.put("/api/auth/me", async (req: Request, res: Response) => {
  try {
    const id = Number((req.body as { id?: number }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Field id wajib diisi" });
    }

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: "Validasi gagal", errors });
    }
    if (parsed.data.name === undefined && parsed.data.email === undefined) {
      return res.status(400).json({ message: "Tidak ada data yang diupdate" });
    }

    const fields: string[] = [];
    const values: any[] = [];
    if (parsed.data.name !== undefined) {
      fields.push("name = ?");
      values.push(parsed.data.name);
    }
    if (parsed.data.email !== undefined) {
      fields.push("email = ?");
      values.push(parsed.data.email);
    }
    values.push(id);

    try {
      const [result] = await pool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
      if ((result as any).affectedRows === 0) {
        return res.status(404).json({ message: "User tidak ditemukan" });
      }
    } catch (error: any) {
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(400).json({ message: "Email sudah terdaftar" });
      }
      throw error;
    }

    const [rows] = await pool.query("SELECT id, name, email FROM users WHERE id = ?", [id]);
    const user = (rows as any[])[0];

    res.status(200).json({
      message: "Profil berhasil diupdate",
      data: user,
      user,
    });
  } catch {
    res.status(400).json({ message: "Gagal mengupdate profil" });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Blog app listening on http://localhost:${port} dan http://10.2.15.67:${port}`);
});
