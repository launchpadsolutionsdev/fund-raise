/**
 * Upload form handling with drag-and-drop support.
 */

document.addEventListener('DOMContentLoaded', function() {
    const dateInput = document.getElementById('snapshot-date');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    document.querySelectorAll('.upload-zone').forEach(zone => {
        zone.addEventListener('dragover', function(e) {
            e.preventDefault();
            this.classList.add('dragover');
        });
        zone.addEventListener('dragleave', function() {
            this.classList.remove('dragover');
        });
        zone.addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('dragover');
            const input = this.querySelector('input[type="file"]');
            if (input && e.dataTransfer.files.length > 0) {
                input.files = e.dataTransfer.files;
                this.classList.add('uploaded');
            }
        });
    });

    document.querySelectorAll('.upload-zone input[type="file"]').forEach(input => {
        input.addEventListener('change', function() {
            const zone = this.closest('.upload-zone');
            if (this.files.length > 0) {
                zone.classList.add('uploaded');
            } else {
                zone.classList.remove('uploaded');
            }
        });
    });

    const form = document.getElementById('upload-form');
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            uploadFiles();
        });
    }
});

async function uploadFiles() {
    const form = document.getElementById('upload-form');
    const btn = document.getElementById('upload-btn');
    const progressDiv = document.getElementById('upload-progress');
    const progressBar = document.getElementById('progress-bar');
    const resultsDiv = document.getElementById('upload-results');
    const overwriteWarning = document.getElementById('overwrite-warning');

    const fileInputs = form.querySelectorAll('input[type="file"]');
    let hasFiles = false;
    fileInputs.forEach(input => { if (input.files.length > 0) hasFiles = true; });
    if (!hasFiles) {
        alert('Please select at least one spreadsheet to upload.');
        return;
    }

    btn.disabled = true;
    progressDiv.classList.remove('d-none');
    resultsDiv.classList.add('d-none');
    progressBar.style.width = '10%';

    const formData = new FormData(form);

    const overwriteCheck = document.getElementById('overwrite-check');
    if (overwriteCheck && overwriteCheck.checked) {
        formData.append('overwrite', 'true');
    }

    try {
        progressBar.style.width = '30%';
        const response = await fetch('/upload/process', {
            method: 'POST',
            body: formData,
        });

        progressBar.style.width = '80%';
        const data = await response.json();

        if (response.status === 409) {
            overwriteWarning.classList.remove('d-none');
            progressDiv.classList.add('d-none');
            btn.disabled = false;
            return;
        }

        progressBar.style.width = '100%';
        overwriteWarning.classList.add('d-none');

        resultsDiv.classList.remove('d-none');
        let html = '';

        if (data.status === 'success') {
            html = '<div class="alert-card success"><div class="alert-card-title">All files uploaded and processed successfully!</div></div>';
            if (data.results) {
                Object.keys(data.results).forEach(dept => {
                    const zone = document.getElementById('zone-' + dept);
                    if (zone) zone.classList.add('uploaded');
                });
            }
        } else if (data.status === 'partial') {
            html = '<div class="alert-card warning" style="margin-bottom:8px;"><div class="alert-card-title">Some files had errors</div></div>';
            if (data.errors) {
                Object.entries(data.errors).forEach(([dept, err]) => {
                    html += `<div class="alert-card danger" style="margin-bottom:4px;"><div class="alert-card-title">${dept}</div><div class="alert-card-text">${err}</div></div>`;
                    const zone = document.getElementById('zone-' + dept);
                    if (zone) zone.classList.add('error');
                });
            }
        } else if (data.error) {
            html = `<div class="alert-card danger"><div class="alert-card-title">${data.error}</div></div>`;
        }

        resultsDiv.innerHTML = html;
        setTimeout(() => { progressDiv.classList.add('d-none'); }, 1000);

    } catch (err) {
        resultsDiv.classList.remove('d-none');
        resultsDiv.innerHTML = `<div class="alert-card danger"><div class="alert-card-title">Upload failed: ${err.message}</div></div>`;
        progressDiv.classList.add('d-none');
    }

    btn.disabled = false;
}
