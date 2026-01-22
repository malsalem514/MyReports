'use client';

import { useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  getQuebecComplianceReport,
  getComplianceTrend,
  QuebecComplianceReport,
  EmployeeComplianceRecord
} from '@/features/hr-dashboard/actions/quebec-compliance-actions';
import { EmailBasedAccessContext } from '@/lib/auth/manager-access';
import {
  IconUser,
  IconRefresh,
  IconBuilding,
  IconHome,
  IconAlertTriangle,
  IconCheck,
  IconX,
  IconChevronDown,
  IconChevronRight,
  IconTrendingUp,
  IconUsers,
  IconShield
} from '@tabler/icons-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

export function QuebecComplianceReport() {
  const [report, setReport] = useState<QuebecComplianceReport | null>(null);
  const [trendData, setTrendData] = useState<{ weekStart: string; complianceRate: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterEmail, setFilterEmail] = useState('');
  const [appliedEmail, setAppliedEmail] = useState('');
  const [weeksBack, setWeeksBack] = useState('4');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchData = async (email?: string, weeks?: number) => {
    setLoading(true);
    setError(null);
    try {
      const [reportData, trend] = await Promise.all([
        getQuebecComplianceReport(email, weeks || parseInt(weeksBack)),
        getComplianceTrend(email, 12)
      ]);
      setReport(reportData);
      setTrendData(trend.weeks);
      setAppliedEmail(email || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch compliance data');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilter = () => {
    fetchData(filterEmail.trim() || undefined, parseInt(weeksBack));
  };

  const handleClearFilter = () => {
    setFilterEmail('');
    setAppliedEmail('');
    fetchData(undefined, parseInt(weeksBack));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleApplyFilter();
    }
  };

  const toggleRow = (email: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(email)) {
      newExpanded.delete(email);
    } else {
      newExpanded.add(email);
    }
    setExpandedRows(newExpanded);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Compliant':
        return <Badge className="bg-green-600"><IconCheck className="mr-1 h-3 w-3" />Compliant</Badge>;
      case 'At Risk':
        return <Badge className="bg-yellow-600"><IconAlertTriangle className="mr-1 h-3 w-3" />At Risk</Badge>;
      case 'Non-Compliant':
        return <Badge className="bg-red-600"><IconX className="mr-1 h-3 w-3" />Non-Compliant</Badge>;
      default:
        return <Badge variant="outline">No Data</Badge>;
    }
  };

  const getComplianceColor = (rate: number) => {
    if (rate >= 80) return 'text-green-600';
    if (rate >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const filteredEmployees = report?.employees.filter((emp) => {
    if (statusFilter === 'all') return true;
    return emp.currentWeekStatus === statusFilter;
  }) || [];

  return (
    <div className="space-y-4">
      {/* Filter Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quebec Office Attendance Compliance</CardTitle>
          <CardDescription>
            Track compliance with the 2 days/week office requirement for Quebec employees.
            Enter your email to view your team's compliance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[250px]">
              <IconUser className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Enter email address to filter by access"
                value={filterEmail}
                onChange={(e) => setFilterEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-10"
              />
            </div>
            <Select value={weeksBack} onValueChange={setWeeksBack}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Weeks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 weeks</SelectItem>
                <SelectItem value="4">4 weeks</SelectItem>
                <SelectItem value="8">8 weeks</SelectItem>
                <SelectItem value="12">12 weeks</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleApplyFilter} disabled={loading}>
              Apply Filter
            </Button>
            {appliedEmail && (
              <Button variant="outline" onClick={handleClearFilter} disabled={loading}>
                Clear
              </Button>
            )}
          </div>

          {/* Access Context Info */}
          {report?.accessContext && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {report.accessContext.employeeName || report.accessContext.userEmail}
                </span>
                {report.accessContext.isHRAdmin && (
                  <Badge variant="default" className="bg-purple-600">
                    <IconShield className="mr-1 h-3 w-3" />
                    HR Admin
                  </Badge>
                )}
                {report.accessContext.isManager && !report.accessContext.isHRAdmin && (
                  <Badge variant="secondary">
                    <IconUsers className="mr-1 h-3 w-3" />
                    Manager
                  </Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {report && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Quebec Employees</CardTitle>
              <IconUsers className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{report.summary.totalQuebecEmployees}</div>
              <p className="text-xs text-muted-foreground">
                {report.summary.employeesWithData} with attendance data
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overall Compliance</CardTitle>
              <IconTrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${getComplianceColor(report.summary.overallComplianceRate)}`}>
                {report.summary.overallComplianceRate}%
              </div>
              <p className="text-xs text-muted-foreground">
                Across all weeks in range
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">This Week Compliant</CardTitle>
              <IconCheck className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {report.summary.currentWeekCompliant}
              </div>
              <p className="text-xs text-muted-foreground">
                Met 2-day office requirement
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">This Week At Risk</CardTitle>
              <IconAlertTriangle className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <span className="text-yellow-600">{report.summary.currentWeekAtRisk}</span>
                {' / '}
                <span className="text-red-600">{report.summary.currentWeekNonCompliant}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                At risk / Non-compliant
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Trend Chart */}
      {trendData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Compliance Trend</CardTitle>
            <CardDescription>Weekly compliance rate over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="weekStart"
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                  <Tooltip
                    labelFormatter={(value) => `Week of ${value}`}
                    formatter={(value: number) => [`${value}%`, 'Compliance Rate']}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="complianceRate"
                    name="Compliance Rate"
                    stroke="#22c55e"
                    fill="#22c55e"
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Employee Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Employee Compliance Details</CardTitle>
              {appliedEmail && (
                <CardDescription className="mt-1">
                  Filtered for: {appliedEmail}
                </CardDescription>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Non-Compliant">Non-Compliant</SelectItem>
                  <SelectItem value="At Risk">At Risk</SelectItem>
                  <SelectItem value="Compliant">Compliant</SelectItem>
                  <SelectItem value="No Data">No Data</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchData(appliedEmail || undefined, parseInt(weeksBack))}
                disabled={loading}
              >
                <IconRefresh className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="text-center py-8 text-red-500">{error}</div>
          ) : loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading compliance data...</div>
          ) : !report ? (
            <div className="text-center py-8 text-muted-foreground">
              Enter an email and click "Apply Filter" to load compliance data
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No employees match the current filter
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30px]"></TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-center">This Week</TableHead>
                    <TableHead className="text-center">Office Days</TableHead>
                    <TableHead className="text-center">Remote Days</TableHead>
                    <TableHead className="text-center">Compliance Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((emp) => (
                    <Collapsible key={emp.employee.email} asChild>
                      <>
                        <TableRow className="cursor-pointer hover:bg-muted/50">
                          <TableCell>
                            <CollapsibleTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => toggleRow(emp.employee.email)}
                              >
                                {expandedRows.has(emp.employee.email) ? (
                                  <IconChevronDown className="h-4 w-4" />
                                ) : (
                                  <IconChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </CollapsibleTrigger>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{emp.employee.name}</div>
                            <div className="text-xs text-muted-foreground">{emp.employee.email}</div>
                          </TableCell>
                          <TableCell>{emp.employee.department || '-'}</TableCell>
                          <TableCell className="text-center">
                            {getStatusBadge(emp.currentWeekStatus)}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <IconBuilding className="h-4 w-4 text-blue-600" />
                              <span className="font-medium">{emp.totalOfficeDays}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <IconHome className="h-4 w-4 text-orange-600" />
                              <span className="font-medium">{emp.totalRemoteDays}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`font-bold ${getComplianceColor(emp.complianceRate)}`}>
                              {emp.complianceRate}%
                            </span>
                            <div className="text-xs text-muted-foreground">
                              {emp.compliantWeeks}/{emp.totalWeeks} weeks
                            </div>
                          </TableCell>
                        </TableRow>
                        <CollapsibleContent asChild>
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={7} className="p-4">
                              <div className="space-y-2">
                                <div className="text-sm font-medium">Weekly Breakdown</div>
                                <div className="grid gap-2">
                                  {emp.weeks.slice(0, 4).map((week) => (
                                    <div
                                      key={week.weekStart}
                                      className={`flex items-center justify-between p-2 rounded border ${
                                        week.isCompliant ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                                      }`}
                                    >
                                      <div className="text-sm">
                                        <span className="font-medium">Week of {week.weekStart}</span>
                                        <span className="text-muted-foreground ml-2">
                                          ({week.totalDays} work days)
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-1 text-sm">
                                          <IconBuilding className="h-4 w-4 text-blue-600" />
                                          <span>{week.officeDays} office</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-sm">
                                          <IconHome className="h-4 w-4 text-orange-600" />
                                          <span>{week.remoteDays} remote</span>
                                        </div>
                                        {week.isCompliant ? (
                                          <IconCheck className="h-5 w-5 text-green-600" />
                                        ) : (
                                          <IconX className="h-5 w-5 text-red-600" />
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!loading && !error && report && (
            <div className="mt-4 text-sm text-muted-foreground">
              Showing {filteredEmployees.length} of {report.employees.length} Quebec employees
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
