/**
 * Shared CSV export utility for Fund-Raise CRM pages.
 * Usage: window.frExportCSV(filename, headers, rows)
 *   - filename: string, e.g. 'Donor_Scoring_FY2025.csv'
 *   - headers: array of strings, e.g. ['Donor', 'Score', 'Total']
 *   - rows: array of arrays, each inner array matches headers
 */
(function() {
    function escapeCSV(v) {
        var s = String(v == null ? '' : v).replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s + '"' : s;
    }

    window.frExportCSV = function(filename, headers, rows) {
        var lines = [headers.map(escapeCSV).join(',')];
        rows.forEach(function(row) {
            lines.push(row.map(escapeCSV).join(','));
        });
        var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    };
})();
