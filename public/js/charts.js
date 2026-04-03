/**
 * Chart.js helper functions for the Foundation Dashboard.
 */

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
                borderWidth: 2,
                borderColor: '#fff',
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 12 } },
                tooltip: {
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
                borderWidth: 2,
                borderColor: '#fff',
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 12 } },
                tooltip: {
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
                    backgroundColor: 'rgba(33, 135, 197, 0.85)',
                },
                {
                    label: 'Goal',
                    data: goals,
                    backgroundColor: 'rgba(2, 61, 101, 0.3)',
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
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
                    ticks: {
                        callback: function(value) {
                            return '$' + (value >= 1000000 ? (value / 1000000).toFixed(1) + 'M' :
                                         value >= 1000 ? (value / 1000).toFixed(0) + 'K' : value);
                        }
                    }
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
                backgroundColor: color || 'rgba(13, 110, 253, 0.8)',
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
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
                    ticks: {
                        callback: function(value) {
                            return '$' + (value >= 1000000 ? (value / 1000000).toFixed(1) + 'M' :
                                         value >= 1000 ? (value / 1000).toFixed(0) + 'K' : value);
                        }
                    }
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
        backgroundColor: colors[i] + '33',
        tension: 0.3,
        fill: false,
    }));

    return new Chart(ctx, {
        type: 'line',
        data: { labels: dates, datasets: datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 12 } },
                tooltip: {
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
                    ticks: {
                        callback: function(value) {
                            return '$' + (value >= 1000000 ? (value / 1000000).toFixed(1) + 'M' :
                                         value >= 1000 ? (value / 1000).toFixed(0) + 'K' : value);
                        }
                    }
                }
            }
        }
    });
}
