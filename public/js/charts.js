/**
 * Chart.js helpers — wireframe design system.
 * Colors: #2187C5 (blue), #D59D2C (gold), #1C7BB6, #52A9DE, #023D65
 */

const chartDefaults = {
    font: { family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", size: 11 },
    color: '#a3a3a3',
    gridColor: 'rgba(0,0,0,0.04)',
    tooltipBg: '#1a1a1a',
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
                    labels: { padding: 10, font: { size: 11 }, color: '#737373', usePointStyle: true, pointStyleWidth: 8 }
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
                    labels: { padding: 10, font: { size: 11 }, color: '#737373', usePointStyle: true, pointStyleWidth: 8 }
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
                    backgroundColor: '#2187C5',
                    borderRadius: { topLeft: 3, topRight: 3 },
                    borderSkipped: 'bottom',
                },
                {
                    label: 'Goal',
                    data: goals,
                    backgroundColor: 'rgba(2, 61, 101, 0.15)',
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
                    labels: { padding: 10, font: { size: 11 }, color: '#737373', usePointStyle: true, pointStyleWidth: 8 }
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
                        color: '#a3a3a3',
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
                backgroundColor: color || '#2187C5',
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
                        color: '#a3a3a3',
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

function createTrendChart(canvasId, trends, deptLabels, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const dates = trends.map(t => t.date);
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
                    labels: { padding: 10, font: { size: 11 }, color: '#737373', usePointStyle: true, pointStyleWidth: 8 }
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
                        color: '#a3a3a3',
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
