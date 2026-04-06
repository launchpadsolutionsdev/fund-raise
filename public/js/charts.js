/**
 * Chart.js helpers — Fund-Raise design system.
 * Colors: #3434D6 (primary indigo), #1A223D (navy), #0D8CFF (blue-end), #12DEFF (cyan)
 */

const chartDefaults = {
    font: { family: "'Manrope', sans-serif", size: 11 },
    color: '#9ca3af',
    gridColor: 'rgba(0,0,0,0.04)',
    tooltipBg: '#1A223D',
};

function applyChartDefaults() {
    Chart.defaults.font.family = chartDefaults.font.family;
    Chart.defaults.font.size = chartDefaults.font.size;
    Chart.defaults.color = chartDefaults.color;
}
applyChartDefaults();

function createPieChart(canvasId, labels, data, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    return new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 1.5,
                borderColor: '#fff',
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            const val = ctx.parsed;
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((val / total) * 100).toFixed(1);
                            return `${ctx.label}: $${val.toLocaleString()} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function createDoughnutChart(canvasId, labels, data, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 1.5,
                borderColor: '#fff',
            }]
        },
        options: {
            responsive: true,
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            return `${ctx.label}: ${ctx.parsed.toLocaleString()}`;
                        }
                    }
                }
            }
        }
    });
}

function createGoalBarChart(canvasId, labels, actual, goals) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Actual',
                    data: actual,
                    backgroundColor: '#3434D6',
                    borderRadius: { topLeft: 3, topRight: 3 },
                    borderSkipped: 'bottom',
                },
                {
                    label: 'Goal',
                    data: goals,
                    backgroundColor: 'rgba(26, 34, 61, 0.15)',
                    borderRadius: { topLeft: 3, topRight: 3 },
                    borderSkipped: 'bottom',
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            return `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartDefaults.gridColor },
                    ticks: {
                        font: { size: 11 },
                        color: '#9ca3af',
                        callback: function(value) {
                            return '$' + (value >= 1e6 ? (value / 1e6).toFixed(1) + 'M' :
                                         value >= 1e3 ? (value / 1e3).toFixed(0) + 'K' : value);
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#a3a3a3' }
                }
            }
        }
    });
}

function createHorizontalBarChart(canvasId, labels, data, color) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: color || '#3434D6',
                borderRadius: { topLeft: 0, topRight: 3, bottomLeft: 0, bottomRight: 3 },
                borderSkipped: 'left',
                barPercentage: 0.7,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            return '$' + ctx.parsed.x.toLocaleString();
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: chartDefaults.gridColor },
                    ticks: {
                        font: { size: 11 },
                        color: '#9ca3af',
                        callback: function(value) {
                            return '$' + (value >= 1e6 ? (value / 1e6).toFixed(1) + 'M' :
                                         value >= 1e3 ? (value / 1e3).toFixed(0) + 'K' : value);
                        }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#737373' }
                }
            }
        }
    });
}

function createGiftDistributionChart(canvasId, buckets, counts, totals) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: buckets,
            datasets: [{
                label: 'Number of Gifts',
                data: counts,
                backgroundColor: '#3434D6',
                borderRadius: { topLeft: 3, topRight: 3 },
                borderSkipped: 'bottom',
                yAxisID: 'y',
            }, {
                label: 'Total Amount',
                data: totals,
                backgroundColor: '#0D8CFF',
                borderRadius: { topLeft: 3, topRight: 3 },
                borderSkipped: 'bottom',
                yAxisID: 'y1',
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            if (ctx.datasetIndex === 0) return `Gifts: ${ctx.parsed.y.toLocaleString()}`;
                            return `Total: $${ctx.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    position: 'left',
                    grid: { color: chartDefaults.gridColor },
                    ticks: { font: { size: 10 }, color: '#9ca3af' },
                    title: { display: true, text: 'Count', font: { size: 10 }, color: '#9ca3af' }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    grid: { display: false },
                    ticks: {
                        font: { size: 10 },
                        color: '#9ca3af',
                        callback: v => '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v)
                    },
                    title: { display: true, text: 'Amount', font: { size: 10 }, color: '#9ca3af' }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 10 }, color: '#9ca3af', maxRotation: 45 }
                }
            }
        }
    });
}

function createDonorConcentrationChart(canvasId, concentration) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const labels = ['Top 10%', 'Top 20%', 'Top 50%', 'Remaining'];
    const top10 = parseFloat(concentration.top10_pct) || 0;
    const top20 = parseFloat(concentration.top20_pct) || 0;
    const top50 = parseFloat(concentration.top50_pct) || 0;
    const values = [top10, top20 - top10, top50 - top20, 100 - top50];
    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values.map(v => Math.max(0, v)),
                backgroundColor: ['#1A223D', '#3434D6', '#0D8CFF', '#e5e7eb'],
                borderWidth: 1.5,
                borderColor: '#fff',
            }]
        },
        options: {
            responsive: true,
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            return `${ctx.label}: ${ctx.parsed.toFixed(1)}% of revenue`;
                        }
                    }
                }
            }
        }
    });
}

function formatWeekLabel(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function createCumulativeGoalChart(canvasId, trends) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const labels = trends.map(t => 'Wk ' + formatWeekLabel(t.date));
    const raised = trends.map(t => t.totalRaised);
    const goal = trends.length ? trends[trends.length - 1].combinedGoal : 0;
    // Goal pace line: linear from 0 to goal
    const goalPace = trends.map((_, i) => goal * (i + 1) / trends.length);
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Cumulative Raised',
                data: raised,
                borderColor: '#3434D6',
                backgroundColor: 'rgba(52, 52, 214, 0.08)',
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointBackgroundColor: '#3434D6',
                borderWidth: 2,
            }, {
                label: 'Goal Pace',
                data: goalPace,
                borderColor: '#0D8CFF',
                borderDash: [6, 3],
                tension: 0,
                fill: false,
                pointRadius: 0,
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            return `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartDefaults.gridColor },
                    ticks: {
                        font: { size: 11 },
                        color: '#9ca3af',
                        callback: v => '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v)
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#9ca3af' }
                }
            }
        }
    });
}

function createChannelMixChart(canvasId, channelData) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['One-time', 'Recurring', 'Online', 'Mailed-in'],
            datasets: [{
                data: [channelData.onetime, channelData.recurring, channelData.online, channelData.mailed],
                backgroundColor: ['#3434D6', '#0D8CFF', '#1A223D', '#12DEFF'],
                borderRadius: { topLeft: 3, topRight: 3 },
                borderSkipped: 'bottom',
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            return `${ctx.label}: ${ctx.parsed.y.toLocaleString()} gifts`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartDefaults.gridColor },
                    ticks: { font: { size: 11 }, color: '#9ca3af' }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#9ca3af' }
                }
            }
        }
    });
}

function createSeasonalityChart(canvasId, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Fill all 12 months (some may have no data)
    const labels = [];
    const gifts = [];
    const totals = [];
    for (let m = 1; m <= 12; m++) {
        labels.push(monthNames[m - 1]);
        const row = data.find(d => d.month === m);
        gifts.push(row ? row.gifts : 0);
        totals.push(row ? row.total : 0);
    }
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Gifts',
                data: gifts,
                backgroundColor: '#3434D6',
                borderRadius: { topLeft: 3, topRight: 3 },
                borderSkipped: 'bottom',
                yAxisID: 'y',
            }, {
                label: 'Amount',
                data: totals,
                type: 'line',
                borderColor: '#0D8CFF',
                backgroundColor: 'rgba(13, 140, 255, 0.1)',
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointBackgroundColor: '#0D8CFF',
                borderWidth: 2,
                yAxisID: 'y1',
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            if (ctx.datasetIndex === 0) return `Gifts: ${ctx.parsed.y.toLocaleString()}`;
                            return `Amount: $${ctx.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    position: 'left',
                    grid: { color: chartDefaults.gridColor },
                    ticks: { font: { size: 10 }, color: '#9ca3af' },
                    title: { display: true, text: 'Gift Count', font: { size: 10 }, color: '#9ca3af' }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    grid: { display: false },
                    ticks: {
                        font: { size: 10 },
                        color: '#9ca3af',
                        callback: v => '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v)
                    },
                    title: { display: true, text: 'Amount', font: { size: 10 }, color: '#9ca3af' }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#9ca3af' }
                }
            }
        }
    });
}

function createComparisonBarChart(canvasId, labels, values1, values2, label1, label2) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: label1,
                data: values1,
                backgroundColor: '#1A223D',
                borderRadius: { topLeft: 3, topRight: 3 },
                borderSkipped: 'bottom',
            }, {
                label: label2,
                data: values2,
                backgroundColor: '#3434D6',
                borderRadius: { topLeft: 3, topRight: 3 },
                borderSkipped: 'bottom',
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            return `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartDefaults.gridColor },
                    ticks: {
                        font: { size: 11 },
                        color: '#9ca3af',
                        callback: v => '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v)
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#9ca3af' }
                }
            }
        }
    });
}

function createProjectionChart(canvasId, trends, projection) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const labels = trends.map(t => 'Wk ' + formatWeekLabel(t.date));
    const raised = trends.map(t => t.totalRaised);
    const goal = projection.goal;

    // Add projection point
    if (projection.fyEndDate) {
        labels.push(projection.fyEndDate);
        raised.push(null); // gap for projection
    }

    // Goal line across all points
    const goalLine = labels.map(() => goal);

    // Projection line from last real point to projected end
    const projLine = labels.map((_, i) => {
        if (i === trends.length - 1) return trends[i].totalRaised;
        if (i === labels.length - 1 && projection.fyEndDate) return projection.projectedTotal;
        return null;
    });

    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Actual',
                data: raised,
                borderColor: '#3434D6',
                backgroundColor: 'rgba(52, 52, 214, 0.08)',
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointBackgroundColor: '#3434D6',
                borderWidth: 2,
                spanGaps: false,
            }, {
                label: 'Projected',
                data: projLine,
                borderColor: '#0D8CFF',
                borderDash: [8, 4],
                tension: 0,
                fill: false,
                pointRadius: 4,
                pointBackgroundColor: '#0D8CFF',
                borderWidth: 2,
                spanGaps: true,
            }, {
                label: 'Goal',
                data: goalLine,
                borderColor: '#dc2626',
                borderDash: [4, 4],
                tension: 0,
                fill: false,
                pointRadius: 0,
                borderWidth: 1.5,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            if (ctx.parsed.y === null) return '';
                            return `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartDefaults.gridColor },
                    ticks: {
                        font: { size: 11 },
                        color: '#9ca3af',
                        callback: v => '$' + (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v)
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#9ca3af' }
                }
            }
        }
    });
}

function createTrendChart(canvasId, trends, deptLabels, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const dates = trends.map(t => 'Wk ' + formatWeekLabel(t.date));
    const deptKeys = Object.keys(deptLabels);
    const datasets = deptKeys.map((key, i) => ({
        label: deptLabels[key],
        data: trends.map(t => (t.departments[key] ? t.departments[key].totalAmount : 0)),
        borderColor: colors[i],
        backgroundColor: colors[i] + '15',
        tension: 0.3,
        fill: false,
        pointRadius: 3,
        pointBackgroundColor: colors[i],
        borderWidth: 2,
    }));

    return new Chart(ctx, {
        type: 'line',
        data: { labels: dates, datasets: datasets },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 10, font: { size: 11 }, color: '#6b7280', usePointStyle: true, pointStyleWidth: 8 }
                },
                tooltip: {
                    backgroundColor: chartDefaults.tooltipBg,
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    padding: 8,
                    cornerRadius: 4,
                    callbacks: {
                        label: function(ctx) {
                            return `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartDefaults.gridColor },
                    ticks: {
                        font: { size: 11 },
                        color: '#9ca3af',
                        callback: function(value) {
                            return '$' + (value >= 1e6 ? (value / 1e6).toFixed(1) + 'M' :
                                         value >= 1e3 ? (value / 1e3).toFixed(0) + 'K' : value);
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#a3a3a3' }
                }
            }
        }
    });
}
