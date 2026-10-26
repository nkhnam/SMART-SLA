export type Organization = { id: string; name: string; type: "Customer" | "Provider"; initials: string };
export type Agreement = { id: string; reference: string; name: string; customerId: string; providerId: string; service: string; uptimeTarget: number; responseTarget: string; reviewDate: string; status: "Active" | "Review required" | "Draft"; createdAt: string; evidenceHash: string; network: string; version: string };
export type Incident = { id: string; agreementId: string; title: string; summary: string; time: string; severity: "low" | "medium" | "high" };
export type Dispute = { id: string; reference: string; agreementId: string; title: string; status: "Under review" | "Awaiting response" | "Resolved"; raisedBy: string; openedAt: string; deadline: string; evidenceCount: number; resolution: string };
export type Observation = { id: string; agreementId: string; agreementName: string; source: string; uptime: number; latencyMs: number; recordedAt: string };
export type VerificationRecord = { id: string; agreementId: string; digest: string; network: string; status: "Evidence prepared" | "Awaiting integration"; recordedAt: string; note: string };

export const organizations: Record<string, Organization> = {
  org_acme: { id: "org_acme", name: "Acme Logistics", type: "Customer", initials: "AL" },
  org_northstar: { id: "org_northstar", name: "Northstar Cloud", type: "Provider", initials: "NC" },
  org_meridian: { id: "org_meridian", name: "Meridian Health", type: "Customer", initials: "MH" },
  org_summit: { id: "org_summit", name: "Summit Network", type: "Provider", initials: "SN" },
};

export const agreements: Agreement[] = [
  { id: "agr-1042", reference: "SLA-2026-1042", name: "Managed cloud operations", customerId: "org_acme", providerId: "org_northstar", service: "Cloud infrastructure", uptimeTarget: 99.95, responseTarget: "≤ 180 ms", reviewDate: "28 Oct 2026", status: "Active", createdAt: "02 Oct 2026", evidenceHash: "0x71a8…c94f", network: "Avalanche · preview", version: "v1.4" },
  { id: "agr-1038", reference: "SLA-2026-1038", name: "Regional network service", customerId: "org_meridian", providerId: "org_summit", service: "Network connectivity", uptimeTarget: 99.9, responseTarget: "≤ 250 ms", reviewDate: "30 Oct 2026", status: "Review required", createdAt: "26 Sep 2026", evidenceHash: "0x8b3f…71d2", network: "Avalanche · preview", version: "v2.1" },
  { id: "agr-1021", reference: "SLA-2026-1021", name: "Order processing API", customerId: "org_acme", providerId: "org_summit", service: "API services", uptimeTarget: 99.5, responseTarget: "≤ 350 ms", reviewDate: "05 Nov 2026", status: "Active", createdAt: "18 Sep 2026", evidenceHash: "0x2c44…aa05", network: "Avalanche · preview", version: "v1.2" },
  { id: "agr-1014", reference: "SLA-2026-1014", name: "Patient data exchange", customerId: "org_meridian", providerId: "org_northstar", service: "Data services", uptimeTarget: 99.99, responseTarget: "≤ 120 ms", reviewDate: "12 Nov 2026", status: "Active", createdAt: "08 Sep 2026", evidenceHash: "0x9441…c10e", network: "Avalanche · preview", version: "v3.0" },
];

export const incidents: Incident[] = [
  { id: "inc-207", agreementId: "agr-1038", title: "Latency threshold exceeded", summary: "Primary and secondary sources recorded elevated response time for 11 minutes.", time: "Today, 10:42 AM", severity: "high" },
  { id: "inc-206", agreementId: "agr-1042", title: "Independent source mismatch", summary: "Two monitoring sources differed by 0.08 percentage points; review is recommended.", time: "Today, 9:18 AM", severity: "medium" },
  { id: "inc-205", agreementId: "agr-1021", title: "Scheduled maintenance window", summary: "Provider maintenance was noted against the agreement exclusion schedule.", time: "Yesterday, 4:30 PM", severity: "low" },
  { id: "inc-204", agreementId: "agr-1014", title: "Evidence window complete", summary: "A daily observation window was assembled for independent review.", time: "Yesterday, 12:00 PM", severity: "low" },
];

export const disputes: Dispute[] = [
  { id: "disp-089", reference: "DSP-2026-089", agreementId: "agr-1038", title: "October latency observation", status: "Under review", raisedBy: "org_summit", openedAt: "24 Oct 2026 · 11:06 AM", deadline: "27 Oct 2026 · 11:06 AM", evidenceCount: 6, resolution: "No resolution recorded. Review is pending." },
  { id: "disp-084", reference: "DSP-2026-084", agreementId: "agr-1042", title: "Regional probe discrepancy", status: "Awaiting response", raisedBy: "org_northstar", openedAt: "22 Oct 2026 · 2:14 PM", deadline: "28 Oct 2026 · 2:14 PM", evidenceCount: 4, resolution: "No resolution recorded. Provider response is pending." },
  { id: "disp-071", reference: "DSP-2026-071", agreementId: "agr-1021", title: "Maintenance classification", status: "Resolved", raisedBy: "org_acme", openedAt: "18 Oct 2026 · 9:30 AM", deadline: "20 Oct 2026 · 9:30 AM", evidenceCount: 5, resolution: "Demo record: observation excluded from the review window." },
];

export const observations: Observation[] = [
  { id: "obs-1", agreementId: "agr-1042", agreementName: "Managed cloud operations", source: "Northstar probe", uptime: 99.982, latencyMs: 142, recordedAt: "25 Oct · 11:45 AM" },
  { id: "obs-2", agreementId: "agr-1038", agreementName: "Regional network service", source: "Regional monitor", uptime: 99.884, latencyMs: 312, recordedAt: "25 Oct · 11:40 AM" },
  { id: "obs-3", agreementId: "agr-1021", agreementName: "Order processing API", source: "API health check", uptime: 99.972, latencyMs: 218, recordedAt: "25 Oct · 11:35 AM" },
  { id: "obs-4", agreementId: "agr-1014", agreementName: "Patient data exchange", source: "Independent probe", uptime: 99.994, latencyMs: 98, recordedAt: "25 Oct · 11:30 AM" },
  { id: "obs-5", agreementId: "agr-1042", agreementName: "Managed cloud operations", source: "Provider report", uptime: 99.901, latencyMs: 151, recordedAt: "25 Oct · 11:25 AM" },
  { id: "obs-6", agreementId: "agr-1038", agreementName: "Regional network service", source: "Independent probe", uptime: 99.913, latencyMs: 284, recordedAt: "25 Oct · 11:20 AM" },
  { id: "obs-7", agreementId: "agr-1021", agreementName: "Order processing API", source: "Regional probe", uptime: 99.964, latencyMs: 226, recordedAt: "25 Oct · 11:15 AM" },
];

export const verificationRecords: VerificationRecord[] = agreements.map((agreement, index) => ({ id: `ver-${index+1}`, agreementId: agreement.id, digest: agreement.evidenceHash, network: agreement.network, status: index===0?"Evidence prepared":"Awaiting integration", recordedAt: agreement.createdAt, note: "Sample record only; no transaction was submitted." }));

export const agreementById = (id: string) => agreements.find(item => item.id===id);
export const incidentsForAgreement = (id: string) => incidents.filter(item => item.agreementId===id);
export const disputesForAgreement = (id: string) => disputes.filter(item => item.agreementId===id);
export const averageUptime = observations.reduce((sum,item)=>sum+item.uptime,0)/observations.length;
export const featuredAgreement = agreements[0];
export const featuredObservations = observations.filter(item=>item.agreementId===featuredAgreement.id);
export const featuredSourceVariance = Math.max(...featuredObservations.map(item=>item.uptime))-Math.min(...featuredObservations.map(item=>item.uptime));
