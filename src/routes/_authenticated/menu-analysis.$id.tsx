import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine, BarChart, Bar, Legend } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useEffect } from "react";
import { ArrowLeft, Sparkles, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { generateSalesInsights } from "@/lib/sales-reports.functions";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/_authenticated/menu-analysis/$id")({
  component: MenuAnalysisDetail,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const COLORS = ["#059669", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

type Report = {
  id: string;
  reference_month: string;
  file_name: string | null;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  total_quantity: number;
  ai_insights: string | null;
};

type Item = {
  id: string;
  product_code: string;
  item_name: string;
  category: string | null;
  source: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  revenue: number;
  total_cost: number;
  margin: number;
};

type Unmapped = { product_code: string; quantity: number };

function MenuAnalysisDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);
  const revenueChartRef = useRef<HTMLDivElement>(null);
  const cmvChartRef = useRef<HTMLDivElement>(null);
  const matrixChartRef = useRef<HTMLDivElement>(null);

  const { data: report } = useQuery<Report | null>({
    queryKey: ["sales-report", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sales_reports").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => (q.state.data && !q.state.data.ai_insights ? 3000 : false),
  });

  const { data: items } = useQuery<Item[]>({
    queryKey: ["sales-report-items", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sales_report_items").select("*").eq("report_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: unmapped } = useQuery<Unmapped[]>({
    queryKey: ["sales-report-unmapped", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sales_report_unmapped").select("product_code, quantity").eq("report_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const insights = useServerFn(generateSalesInsights);
  async function regenerate() {
    setRegenerating(true);
    try {
      await insights({ data: { report_id: id } });
      qc.invalidateQueries({ queryKey: ["sales-report", id] });
      toast.success("Parecer atualizado");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRegenerating(false);
    }
  }

  const byCategory = useMemo(() => {
    const map = new Map<string, { revenue: number; cost: number; quantity: number; count: number }>();
    for (const i of items ?? []) {
      const c = i.category ?? "Sem categoria";
      const e = map.get(c) ?? { revenue: 0, cost: 0, quantity: 0, count: 0 };
      e.revenue += Number(i.revenue);
      e.cost += Number(i.total_cost);
      e.quantity += Number(i.quantity);
      e.count += 1;
      map.set(c, e);
    }
    return Array.from(map.entries()).map(([name, v]) => ({
      name,
      revenue: v.revenue,
      cost: v.cost,
      cmv_pct: v.revenue > 0 ? (v.cost / v.revenue) * 100 : 0,
      quantity: v.quantity,
      count: v.count,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [items]);

  const matrix = useMemo(() => {
    const list = items ?? [];
    if (list.length === 0) return { avgQty: 0, avgMargin: 0, points: [], quadrants: { champ: [], hidden: [], dog: [], problem: [] } as Record<string, any[]> };
    const avgQty = list.reduce((s, i) => s + Number(i.quantity), 0) / list.length;
    const avgMargin = list.reduce((s, i) => {
      const r = Number(i.revenue);
      return s + (r > 0 ? (Number(i.margin) / r) * 100 : 0);
    }, 0) / list.length;
    const points = list.map((i) => {
      const r = Number(i.revenue);
      const marginPct = r > 0 ? (Number(i.margin) / r) * 100 : 0;
      const hi = Number(i.quantity) >= avgQty;
      const ha = marginPct >= avgMargin;
      const q = hi && ha ? "champ" : !hi && ha ? "hidden" : hi && !ha ? "dog" : "problem";
      return { ...i, quantity: Number(i.quantity), marginPct, quadrant: q };
    });
    const quadrants = {
      champ: points.filter((p) => p.quadrant === "champ"),
      hidden: points.filter((p) => p.quadrant === "hidden"),
      dog: points.filter((p) => p.quadrant === "dog"),
      problem: points.filter((p) => p.quadrant === "problem"),
    };
    return { avgQty, avgMargin, points, quadrants };
  }, [items]);

  if (!report) return <div className="p-8">Carregando...</div>;

  const cmvGlobal = report.total_revenue > 0 ? (report.total_cost / report.total_revenue) * 100 : 0;

  async function captureSvg(container: HTMLElement | null): Promise<{ data: string; w: number; h: number } | null> {
    if (!container) return null;
    const svg = container.querySelector("svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    // Inline computed text color to avoid CSS var loss when serializing
    const style = document.createElement("style");
    style.textContent = "text{font-family:Arial,Helvetica,sans-serif;fill:#333}";
    clone.insertBefore(style, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img load")); img.src = src; });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL("image/png"), w, h };
  }

  async function exportPdf() {
    if (!report) return;
    // Capture charts BEFORE building PDF (needs DOM present)
    let revenueImg: Awaited<ReturnType<typeof captureSvg>> = null;
    let cmvImg: Awaited<ReturnType<typeof captureSvg>> = null;
    let matrixImg: Awaited<ReturnType<typeof captureSvg>> = null;
    try {
      [revenueImg, cmvImg, matrixImg] = await Promise.all([
        captureSvg(revenueChartRef.current),
        captureSvg(cmvChartRef.current),
        captureSvg(matrixChartRef.current),
      ]);
    } catch (e) {
      console.warn("Falha ao capturar gráficos", e);
    }
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const M = 15; // margem 15mm
    const usableW = pageW - M * 2;

    // Paleta (alinhada ao tema Emerald Prestige)
    const EMERALD: [number, number, number] = [15, 76, 63];
    const EMERALD_DARK: [number, number, number] = [10, 54, 46];
    const GOLD: [number, number, number] = [201, 162, 39];
    const INK: [number, number, number] = [28, 36, 42];
    const MUTED: [number, number, number] = [110, 118, 125];
    const SOFT: [number, number, number] = [244, 246, 244];

    let y = M;

    const ensure = (h: number) => {
      if (y + h > pageH - M - 10) {
        doc.addPage();
        y = M;
      }
    };

    const sectionTitle = (title: string, subtitle?: string) => {
      ensure(subtitle ? 22 : 14);
      doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.rect(M, y + 1, 3, 7, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(EMERALD_DARK[0], EMERALD_DARK[1], EMERALD_DARK[2]);
      doc.text(title, M + 5, y + 6);
      y += 10;
      if (subtitle) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        doc.text(subtitle, M + 5, y + 3);
        y += 7;
      }
      y += 2;
      doc.setTextColor(INK[0], INK[1], INK[2]);
    };

    // ===== Capa / cabeçalho =====
    doc.setFillColor(EMERALD[0], EMERALD[1], EMERALD[2]);
    doc.rect(0, 0, pageW, 42, "F");
    doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
    doc.rect(0, 42, pageW, 1.5, "F");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(220, 220, 210);
    doc.text("RELATÓRIO DE ANÁLISE DE VENDAS", M, 15);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(255, 255, 255);
    doc.text(formatMonth(report.reference_month), M, 27);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(220, 220, 210);
    const meta: string[] = [];
    if (report.file_name) meta.push(report.file_name);
    meta.push(`Gerado em ${new Date().toLocaleString("pt-BR")}`);
    doc.text(meta.join("  •  "), M, 36);

    doc.setTextColor(INK[0], INK[1], INK[2]);
    y = 52;

    // ===== KPIs =====
    sectionTitle("Visão geral", "Indicadores principais do período");
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      tableWidth: usableW,
      head: [["Faturamento", "Custo total", "Margem", "CMV global"]],
      body: [[
        BRL.format(report.total_revenue),
        BRL.format(report.total_cost),
        BRL.format(report.total_margin),
        `${cmvGlobal.toFixed(1)}%`,
      ]],
      styles: { fontSize: 11, halign: "center", cellPadding: 4, textColor: INK },
      headStyles: { fillColor: EMERALD, textColor: [255, 255, 255], fontStyle: "bold" },
      bodyStyles: { fillColor: SOFT, fontStyle: "bold" },
    });
    y = (doc as any).lastAutoTable.finalY + 10;

    // ===== Por categoria =====
    if (byCategory.length > 0) {
      sectionTitle(
        "Desempenho por categoria",
        "Volume, faturamento e CMV agrupados por categoria de item",
      );
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        tableWidth: usableW,
        head: [["Categoria", "Qtd", "Faturamento", "Custo", "CMV %"]],
        body: byCategory.map((c) => [
          c.name,
          c.quantity.toLocaleString("pt-BR"),
          BRL.format(c.revenue),
          BRL.format(c.cost),
          `${c.cmv_pct.toFixed(1)}%`,
        ]),
        styles: { fontSize: 9, cellPadding: 2.6, textColor: INK },
        headStyles: { fillColor: EMERALD, textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: SOFT },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    // ===== Gráficos =====
    if (revenueImg || cmvImg) {
      const gap = 5;
      const colW = (usableW - gap) / 2;
      const imgs = [revenueImg, cmvImg].filter(Boolean) as { data: string; w: number; h: number }[];
      const heights = imgs.map((im) => (colW * im.h) / im.w);
      const rowH = Math.max(...heights);
      ensure(rowH + 18);
      sectionTitle(
        "Faturamento e CMV por categoria",
        "Visualização comparativa das categorias analisadas",
      );
      let x = M;
      for (const im of imgs) {
        const h = (colW * im.h) / im.w;
        doc.addImage(im.data, "PNG", x, y, colW, h);
        x += colW + gap;
      }
      y += rowH + 8;
    }

    // ===== Top 20 =====
    const topItems = [...(items ?? [])].sort((a, b) => Number(b.revenue) - Number(a.revenue)).slice(0, 20);
    if (topItems.length > 0) {
      sectionTitle(
        "Top 20 itens por faturamento",
        "Itens com maior contribuição de receita no período",
      );
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        tableWidth: usableW,
        head: [["Item", "Categoria", "Qtd", "Faturamento", "Margem %"]],
        body: topItems.map((i) => {
          const m = Number(i.revenue) > 0 ? (Number(i.margin) / Number(i.revenue)) * 100 : 0;
          return [
            i.item_name,
            i.category ?? "—",
            Number(i.quantity).toLocaleString("pt-BR"),
            BRL.format(Number(i.revenue)),
            `${m.toFixed(1)}%`,
          ];
        }),
        styles: { fontSize: 9, overflow: "linebreak", cellPadding: 2.4, textColor: INK },
        headStyles: { fillColor: EMERALD, textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: SOFT },
        columnStyles: { 0: { cellWidth: 60 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }

    // ===== Matriz BCG =====
    sectionTitle(
      "Engenharia de menu",
      `Médias — quantidade ${matrix.avgQty.toFixed(0)} • margem ${matrix.avgMargin.toFixed(1)}%`,
    );

    if (matrixImg) {
      const h = (usableW * matrixImg.h) / matrixImg.w;
      ensure(h + 4);
      doc.addImage(matrixImg.data, "PNG", M, y, usableW, h);
      y += h + 8;
    }

    const quads: Array<[string, string, any[]]> = [
      ["Campeões", "vende muito + alta margem", matrix.quadrants.champ],
      ["Tesouros escondidos", "vende pouco + alta margem", matrix.quadrants.hidden],
      ["Queridinhos", "vende muito + baixa margem", matrix.quadrants.dog],
      ["Problemas", "vende pouco + baixa margem", matrix.quadrants.problem],
    ];
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      tableWidth: usableW,
      head: [["Quadrante", "Descrição", "Itens"]],
      body: quads.map(([t, d, arr]) => [
        `${t} (${arr.length})`,
        d,
        arr.map((p) => p.item_name).join(", ") || "—",
      ]),
      styles: { fontSize: 9, overflow: "linebreak", valign: "top", cellPadding: 2.6, textColor: INK },
      headStyles: { fillColor: EMERALD, textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: SOFT },
      columnStyles: {
        0: { cellWidth: 42, fontStyle: "bold", textColor: EMERALD_DARK },
        1: { cellWidth: 45, textColor: MUTED, fontStyle: "italic" },
      },
    });
    y = (doc as any).lastAutoTable.finalY + 10;

    // ===== Parecer IA =====
    if (report.ai_insights) {
      sectionTitle("Parecer da IA", "Interpretação automática dos dados apresentados");

      const clean = report.ai_insights.replace(/`([^`]+)`/g, "$1");
      const paragraphs = clean.split(/\n{2,}/);

      for (const raw of paragraphs) {
        const block = raw.trim();
        if (!block) continue;

        const headingMatch = block.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const text = headingMatch[2]
            .replace(/\*\*(.+?)\*\*/g, "$1")
            .replace(/\*(.+?)\*/g, "$1");
          const size = level <= 2 ? 12 : 10.5;
          ensure(8);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(size);
          doc.setTextColor(EMERALD_DARK[0], EMERALD_DARK[1], EMERALD_DARK[2]);
          const lines = doc.splitTextToSize(text, usableW);
          for (const ln of lines) {
            ensure(6);
            doc.text(ln, M, y);
            y += 5.5;
          }
          y += 1.5;
          doc.setTextColor(INK[0], INK[1], INK[2]);
          continue;
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        const isBullet = /^[-*•]\s+/.test(block);
        const bodyText = block
          .replace(/^[-*•]\s+/, "")
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .replace(/\*(.+?)\*/g, "$1");
        const prefix = isBullet ? "•  " : "";
        const indent = isBullet ? 5 : 0;
        const lines = doc.splitTextToSize(prefix + bodyText, usableW - indent);
        const lh = 5;
        for (let i = 0; i < lines.length; i++) {
          ensure(lh);
          doc.text(lines[i], M + (i === 0 ? 0 : indent), y);
          y += lh;
        }
        y += 2;
      }
    }

    // ===== Rodapé =====
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
      doc.setLineWidth(0.4);
      doc.line(M, pageH - 12, pageW - M, pageH - 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(`Análise de ${formatMonth(report.reference_month)}`, M, pageH - 7);
      doc.text(`Página ${p} de ${totalPages}`, pageW - M, pageH - 7, { align: "right" });
    }

    doc.save(`analise-${report.reference_month}.pdf`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/menu-analysis" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="mr-1 h-4 w-4" /> Análises
          </Link>
          <h1 className="font-display text-3xl mt-1">Análise de {formatMonth(report.reference_month)}</h1>
          <p className="text-sm text-muted-foreground">{report.file_name}</p>
        </div>
        <Button variant="outline" onClick={exportPdf}>
          <Download className="mr-1 h-4 w-4" /> Exportar PDF
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Faturamento" value={BRL.format(report.total_revenue)} />
        <Kpi label="Custo total" value={BRL.format(report.total_cost)} />
        <Kpi label="Margem" value={BRL.format(report.total_margin)} />
        <Kpi label="CMV teórico" value={`${cmvGlobal.toFixed(1)}%`} />
        <CmvRealKpi reportId={id} theoretical={cmvGlobal} />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Faturamento por categoria">
          <div ref={revenueChartRef}>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={byCategory} dataKey="revenue" nameKey="name" outerRadius={100} label={(e: any) => e.name}>
                  {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => BRL.format(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="CMV % por categoria">
          <div ref={cmvChartRef}>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byCategory}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                <Bar dataKey="cmv_pct" name="CMV">
                  {byCategory.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Top itens por categoria */}
      <Card title="Top itens por categoria">
        {byCategory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados.</p>
        ) : (
          <Tabs defaultValue={byCategory[0].name}>
            <TabsList className="flex-wrap h-auto">
              {byCategory.map((c) => <TabsTrigger key={c.name} value={c.name}>{c.name}</TabsTrigger>)}
            </TabsList>
            {byCategory.map((c) => {
              const top = (items ?? [])
                .filter((i) => (i.category ?? "Sem categoria") === c.name)
                .sort((a, b) => Number(b.revenue) - Number(a.revenue))
                .slice(0, 5);
              return (
                <TabsContent key={c.name} value={c.name}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">Faturamento</TableHead>
                        <TableHead className="text-right">Margem %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {top.map((i) => {
                        const m = Number(i.revenue) > 0 ? (Number(i.margin) / Number(i.revenue)) * 100 : 0;
                        return (
                          <TableRow key={i.id}>
                            <TableCell>{i.item_name}</TableCell>
                            <TableCell className="text-right">{Number(i.quantity).toLocaleString("pt-BR")}</TableCell>
                            <TableCell className="text-right">{BRL.format(Number(i.revenue))}</TableCell>
                            <TableCell className="text-right">{m.toFixed(1)}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </Card>

      {/* Matriz BCG */}
      <Card title="Matriz do cardápio (engenharia de menu)">
        <p className="text-xs text-muted-foreground mb-3">
          Linhas divisórias: média de quantidade ({matrix.avgQty.toFixed(0)}) e média de margem ({matrix.avgMargin.toFixed(1)}%).
        </p>
        <div ref={matrixChartRef}>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis type="number" dataKey="quantity" name="Quantidade" />
              <YAxis type="number" dataKey="marginPct" name="Margem %" tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <ReferenceLine x={matrix.avgQty} stroke="#94a3b8" strokeDasharray="3 3" />
              <ReferenceLine y={matrix.avgMargin} stroke="#94a3b8" strokeDasharray="3 3" />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d: any = payload[0].payload;
                return (
                  <div className="rounded-md border bg-card px-3 py-2 text-xs shadow">
                    <div className="font-medium">{d.item_name}</div>
                    <div>Qtd: {d.quantity}</div>
                    <div>Margem: {d.marginPct.toFixed(1)}%</div>
                    <div>Faturamento: {BRL.format(d.revenue)}</div>
                  </div>
                );
              }} />
              <Scatter name="Campeões" data={matrix.quadrants.champ} fill="#10b981" />
              <Scatter name="Tesouros escondidos" data={matrix.quadrants.hidden} fill="#3b82f6" />
              <Scatter name="Queridinhos" data={matrix.quadrants.dog} fill="#f59e0b" />
              <Scatter name="Problemas" data={matrix.quadrants.problem} fill="#ef4444" />
              <Legend />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-4">
          <QuadrantList title="Campeões" desc="Vende muito + alta margem" color="bg-green-500/15 text-green-700 dark:text-green-400" items={matrix.quadrants.champ} />
          <QuadrantList title="Tesouros escondidos" desc="Vende pouco + alta margem" color="bg-blue-500/15 text-blue-700 dark:text-blue-400" items={matrix.quadrants.hidden} />
          <QuadrantList title="Queridinhos" desc="Vende muito + baixa margem" color="bg-amber-500/15 text-amber-700 dark:text-amber-400" items={matrix.quadrants.dog} />
          <QuadrantList title="Problemas" desc="Vende pouco + baixa margem" color="bg-red-500/15 text-red-700 dark:text-red-400" items={matrix.quadrants.problem} />
        </div>
      </Card>

      {/* AI parecer */}
      <Card title={<div className="flex items-center justify-between w-full"><span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Parecer da IA</span><Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating}>{regenerating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Regenerar</Button></div>}>
        {!report.ai_insights ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Gerando parecer...</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{report.ai_insights}</ReactMarkdown>
          </div>
        )}
      </Card>

      {unmapped && unmapped.length > 0 && (
        <Card title="Códigos não encontrados no cardápio">
          <p className="text-xs text-muted-foreground mb-2">Vincule esses códigos a fichas técnicas ou produtos manuais para incluí-los na próxima análise.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unmapped.map((u, i) => (
                <TableRow key={i}>
                  <TableCell>{u.product_code}</TableCell>
                  <TableCell className="text-right">{Number(u.quantity).toLocaleString("pt-BR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-2xl mt-1">{value}</div>
    </div>
  );
}

function CmvRealKpi({ reportId, theoretical }: { reportId: string; theoretical: number }) {
  const key = `cmv-real:${reportId}`;
  const [val, setVal] = useState<string>("");
  useEffect(() => {
    try { setVal(localStorage.getItem(key) ?? ""); } catch {}
  }, [key]);
  const num = Number(val.replace(",", "."));
  const valid = val !== "" && Number.isFinite(num);
  const diff = valid ? num - theoretical : 0;
  const diffColor = !valid ? "" : diff > 0 ? "text-red-600" : diff < 0 ? "text-green-600" : "text-muted-foreground";
  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="text-xs text-muted-foreground">CMV real (%)</div>
      <div className="mt-1 flex items-center gap-2">
        <Input
          type="text"
          inputMode="decimal"
          placeholder="0,0"
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            try { localStorage.setItem(key, e.target.value); } catch {}
          }}
          className="h-9 font-display text-2xl px-2"
        />
        <span className="text-muted-foreground text-sm">%</span>
      </div>
      {valid && (
        <div className={`mt-1 text-xs ${diffColor}`}>
          {diff > 0 ? "+" : ""}{diff.toFixed(1)} p.p. vs teórico
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 md:p-6 shadow-[var(--shadow-soft)]">
      <div className="mb-3 font-medium">{title}</div>
      {children}
    </div>
  );
}

function QuadrantList({ title, desc, color, items }: { title: string; desc: string; color: string; items: any[] }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <Badge variant="outline" className={color}>{title}</Badge>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.length === 0 ? <li className="text-muted-foreground text-xs">—</li> : items.slice(0, 5).map((i) => (
          <li key={i.id} className="truncate" title={i.item_name}>• {i.item_name}</li>
        ))}
        {items.length > 5 && <li className="text-xs text-muted-foreground">+ {items.length - 5} outros</li>}
      </ul>
    </div>
  );
}

function formatMonth(d: string) {
  const [y, m] = d.split("-");
  const names = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${names[Number(m) - 1]}/${y}`;
}
