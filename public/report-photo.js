async function compressReportPhoto(file, maxEdge, maxBytes) {
  const image = await createImageBitmap(file).catch(() => {
    throw Object.assign(new Error("This photo could not be opened. Choose another image."), { status: 400 });
  });
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    let scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.72, 0.6]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob?.type === "image/jpeg" && blob.size <= maxBytes) return blob;
      }
      scale *= 0.75;
    }
    throw Object.assign(new Error("This photo could not be compressed to the upload limit. Choose another image."), { status: 400 });
  } finally {
    image.close();
  }
}

function initIssuePhotoPicker() {
  const pickers = [...document.querySelectorAll("[data-issue-photo-pick]")];
  const remove = find("[data-issue-photo-remove]");
  const name = find("[data-issue-photo-name]");
  const { photoMaxEdge, photoMaxBytes } = document.body.dataset;
  let file;
  let encoded;

  function select(photo) {
    file = photo;
    encoded = undefined;
    name.textContent = photo ? photo.name : "";
    remove.hidden = !photo;
  }

  for (const button of pickers) {
    const input = find(button.dataset.issuePhotoPick);
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files[0]) select(input.files[0]);
      input.value = "";
    });
  }
  remove.addEventListener("click", () => {
    select(undefined);
    pickers[0].focus();
  });

  return {
    async read() {
      if (!file) return undefined;
      if (encoded !== undefined) return encoded;
      const photo = await compressReportPhoto(file, Number(photoMaxEdge), Number(photoMaxBytes));
      encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(Object.assign(new Error("The selected photo could not be read."), { status: 400 }));
        reader.readAsDataURL(photo);
      });
      return encoded;
    },
    setBusy(busy) {
      for (const button of pickers) button.disabled = busy;
      remove.disabled = busy;
    }
  };
}

function initReportPhotoPanel() {
  const panel = find("[data-photo-panel]");
  const form = find("#report-photo-form");
  const fileInput = form.elements.photo;
  const submit = form.querySelector('button[type="submit"]');
  const shared = find("[data-shared-photo]");
  const preview = find("[data-shared-photo-preview]");
  const openLink = find("[data-open-photo-link]");
  const copy = find("[data-copy-photo-link]");
  const remove = find("[data-remove-photo]");
  const feedback = find("[data-photo-feedback]");
  const maxEdge = Number(document.body.dataset.photoMaxEdge);
  const maxBytes = Number(document.body.dataset.photoMaxBytes);
  let selection;

  function renderPhoto(photo) {
    shared.hidden = !photo;
    if (photo) {
      openLink.href = photo.path;
      preview.src = photo.path + "/image?v=" + photo.revision;
    } else {
      preview.removeAttribute("src");
      openLink.removeAttribute("href");
    }
  }

  function setBusy(busy) {
    fileInput.disabled = busy;
    submit.disabled = busy;
    remove.disabled = busy;
  }

  async function updatePhoto(operation, success) {
    const current = selection;
    setBusy(true);
    feedback.textContent = "";
    try {
      const { photo } = await operation(current.path);
      if (selection !== current) return;
      renderPhoto(photo);
      form.reset();
      feedback.textContent = success;
    } catch (error) {
      if (selection !== current) return;
      if (error.status === 401) location.replace("/staff/login");
      else feedback.textContent = errorMessage(error);
    } finally {
      if (selection === current) setBusy(false);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!selection || submit.disabled || !file) return;
    updatePhoto(async (path) => {
      const photo = await compressReportPhoto(file, maxEdge, maxBytes);
      return api(path, { method: "PUT", body: photo });
    }, "Photo shared. Copy the link to send it to the reporter.");
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(openLink.href);
      feedback.textContent = "Photo link copied.";
    } catch {
      feedback.textContent = "Open the photo link and copy its address.";
    }
  });
  remove.addEventListener("click", () => {
    if (selection && !remove.disabled) {
      updatePhoto((path) => api(path, { method: "DELETE" }), "Photo removed.");
    }
  });
  return {
    show(id) {
      if (selection?.id === id) return;
      selection = id ? { id, path: "/api/staff/reports/" + id + "/photo" } : null;
      panel.hidden = !selection;
      panel.open = false;
      form.reset();
      renderPhoto(null);
      setBusy(false);
      feedback.textContent = "";
      if (selection) updatePhoto((path) => api(path), "");
    }
  };
}
