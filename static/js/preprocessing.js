// Progress overlay shown while preprocessing runs.

const PREPROC_STEPS = [
    { label: 'Load data',          sublabel: 'Reading documents' },
    { label: 'Text normalization', sublabel: 'Cleaning tokens' },
    { label: 'Feature extraction', sublabel: 'Vectorizing' },
    { label: 'Class balancing',    sublabel: 'Resampling' },
    { label: 'Finalizing',         sublabel: 'Saving to session' }
];

function showLoadingBar(title, methodsLabel = '') {
    const existing = document.getElementById('preprocOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'preprocOverlay';
    overlay.className = 'preproc-overlay';

    overlay.innerHTML = `
        <div class="preproc-modal">
            <div class="preproc-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
            </div>
            <div class="preproc-title">${title}</div>
            <div class="preproc-methods" id="preprocMethods">${methodsLabel}</div>

            <div class="preproc-steps" id="preprocSteps">
                ${PREPROC_STEPS.map((s, i) => `
                    <div class="preproc-step" id="preprocStep${i}">
                        <div class="ps-dot" id="preprocDot${i}">${i + 1}</div>
                        <div class="ps-text">
                            <div class="ps-label">${s.label}</div>
                            <div class="ps-sublabel" id="preprocSub${i}">${s.sublabel}</div>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="preproc-bar-header">
                <span class="preproc-bar-step-label" id="preprocBarLabel">Starting...</span>
                <span class="preproc-bar-pct" id="preprocBarPct">0%</span>
            </div>
            <div class="preproc-track">
                <div class="preproc-fill" id="preprocFill" style="width:0%"></div>
            </div>
            <div class="preproc-eta" id="preprocEta">Preparing...</div>
        </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function setLoadingStep(stepIndex, sublabelOverride = null) {
    PREPROC_STEPS.forEach((s, i) => {
        const stepEl = document.getElementById(`preprocStep${i}`);
        const dotEl = document.getElementById(`preprocDot${i}`);
        const subEl = document.getElementById(`preprocSub${i}`);
        if (!stepEl) return;

        if (i < stepIndex) {
            stepEl.className = 'preproc-step ps-done';
            dotEl.className = 'ps-dot dot-done';
            dotEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        } else if (i === stepIndex) {
            stepEl.className = 'preproc-step ps-active';
            dotEl.className = 'ps-dot dot-active';
            dotEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/></svg>`;
            if (sublabelOverride && subEl) subEl.textContent = sublabelOverride;
        } else {
            stepEl.className = 'preproc-step';
            dotEl.className = 'ps-dot';
            dotEl.innerHTML = i + 1;
        }
    });
}

function updateLoadingBar(percent, barLabel, eta = '') {
    const fill = document.getElementById('preprocFill');
    const pct = document.getElementById('preprocBarPct');
    const label = document.getElementById('preprocBarLabel');
    const etaEl = document.getElementById('preprocEta');
    if (fill) fill.style.width = `${percent}%`;
    if (pct) pct.textContent = `${Math.round(percent)}%`;
    if (label) label.textContent = barLabel;
    if (etaEl) etaEl.textContent = eta;
}

function hideLoadingBar() {
    const overlay = document.getElementById('preprocOverlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 300);
}

function animateProgress(from, to, durationMs, barLabel, eta = '') {
    return new Promise(resolve => {
        const steps = 40;
        const increment = (to - from) / steps;
        const interval = durationMs / steps;
        let current = from;
        let count = 0;
        updateLoadingBar(current, barLabel, eta);
        const timer = setInterval(() => {
            count++;
            current += increment;
            updateLoadingBar(Math.min(current, to), barLabel, eta);
            if (count >= steps) { clearInterval(timer); resolve(); }
        }, interval);
    });
}

// Simulates smooth progress between two values over a duration
function animateProgress(from, to, durationMs, stepLabel) {
    return new Promise(resolve => {
        const steps = 30;
        const increment = (to - from) / steps;
        const interval = durationMs / steps;
        let current = from;
        let count = 0;

        updateLoadingBar(current, stepLabel);

        const timer = setInterval(() => {
            count++;
            current += increment;
            updateLoadingBar(Math.min(current, to), stepLabel);
            if (count >= steps) {
                clearInterval(timer);
                resolve();
            }
        }, interval);
    });
}

// preprocessing.js
class TextPreprocessor {
    constructor() {
        this.vocabulary = new Set();
        this.processedData = null;
        this.vectorizer = null;
        this.currentSettings = {};
    }

    // Load data from session storage
    loadData() {
        try {
            const csvText = sessionStorage.getItem("uploadedCSV");
            if (!csvText) {
                throw new Error("No data found in session storage");
            }

            return new Promise((resolve, reject) => {
                Papa.parse(csvText, {
                    header: true,
                    skipEmptyLines: true,
                    complete: function(results) {
                        if (results.errors.length > 0) {
                            reject(new Error("CSV parsing error: " + results.errors[0].message));
                            return;
                        }
                        
                        const data = results.data || [];
                        const textCol = sessionStorage.getItem("detectedTextCol");
                        const labelCol = sessionStorage.getItem("detectedLabelCol");
                        
                        if (!textCol || !labelCol || !data.length) {
                            reject(new Error("Could not detect text and label columns"));
                            return;
                        }

                        const processed = data.map(row => ({
                            text: row[textCol]?.toString().trim(),
                            label: row[labelCol]?.toString().trim(),
                            originalText: row[textCol]?.toString().trim()
                        })).filter(row => row.text && row.label);
                        
                        resolve(processed);
                    },
                    error: function(error) {
                        reject(error);
                    }
                });
            });
        } catch (error) {
            console.error("Error loading data:", error);
            throw error;
        }
    }

    // Text normalization
    normalizeText(text, useStemming = false, useLemmatization = false) {
        if (useStemming && useLemmatization) {
            throw new Error("Cannot use both stemming and lemmatization");
        }

        // Convert to lowercase and remove extra whitespace
        let processed = text.toLowerCase().replace(/\s+/g, ' ').trim();
        
        // Remove punctuation and special characters (keep basic punctuation for context)
        processed = processed.replace(/[^\w\s.!?]/g, '');
        
        // Tokenize
        const tokens = processed.split(/\s+/);
        
        if (useStemming) {
            return tokens.map(token => this.stem(token)).join(' ');
        } else if (useLemmatization) {
            return tokens.map(token => this.lemmatize(token)).join(' ');
        }
        
        return tokens.join(' ');
    }

    // Simple stemmer (Porter stemmer simplified)
    stem(token) {
        // Basic stemming rules
        if (token.length < 3) return token;
        
        const rules = [
            [/(ss|i)es$/, '$1'],
            [/([^aeiou])s$/, '$1'],
            [/(eed)$/, 'ee'],
            [/(ed|ing)$/, ''],
            [/y$/, 'i']
        ];
        
        let stemmed = token;
        for (const [pattern, replacement] of rules) {
            if (pattern.test(stemmed)) {
                stemmed = stemmed.replace(pattern, replacement);
                break;
            }
        }
        
        return stemmed;
    }

    // Simple lemmatizer (basic dictionary-based)
    lemmatize(token) {
        const lemmatizationDict = {
            'running': 'run', 'ran': 'run', 'runs': 'run',
            'jumping': 'jump', 'jumped': 'jump', 'jumps': 'jump',
            'walking': 'walk', 'walked': 'walk', 'walks': 'walk',
            'better': 'good', 'best': 'good',
            'worse': 'bad', 'worst': 'bad',
            'is': 'be', 'are': 'be', 'were': 'be', 'was': 'be',
            'has': 'have', 'had': 'have',
            'does': 'do', 'did': 'do',
            'going': 'go', 'went': 'go', 'gone': 'go'
        };
        
        return lemmatizationDict[token] || token;
    }

    // Build vocabulary from processed texts
    buildVocabulary(texts) {
        this.vocabulary.clear();
        texts.forEach(text => {
            const tokens = text.split(/\s+/);
            tokens.forEach(token => {
                if (token.length > 1) { // Ignore single characters
                    this.vocabulary.add(token);
                }
            });
        });
        return this.vocabulary;
    }

    // Vectorize texts based on selected method
    vectorizeTexts(texts, useTF = false, useTFIDF = false, useWord2Vec = false, vectorSizePercent = 100) {
        if (!useTF && !useTFIDF && !useWord2Vec) {
            throw new Error("Please select at least one feature extraction method");
        }
        
        // Word2Vec processing will be done on backend
        if (useWord2Vec) {
            console.log("Word2Vec selected - will be processed on backend");
            // Return placeholder vectors for frontend display
            return texts.map(() => ({
                'word2vec': 'Backend processing required'
            }));
        }
        
        const vocabArray = Array.from(this.vocabulary);
        const actualVectorSize = Math.ceil(vocabArray.length * (vectorSizePercent / 100));
        const selectedVocab = vocabArray.slice(0, actualVectorSize);
        
        if (useTFIDF) {
            return this.calculateTFIDF(texts, selectedVocab);
        } else if (useTF) {
            return this.calculateTF(texts, selectedVocab);
        }
    }

    // Calculate Term Frequency
    calculateTF(texts, vocabulary) {
        return texts.map(text => {
            const tokens = text.split(/\s+/);
            const vector = {};
            let totalWords = tokens.length;
            
            vocabulary.forEach(word => {
                const count = tokens.filter(token => token === word).length;
                vector[word] = count / totalWords;
            });
            
            return vector;
        });
    }

    // Calculate TF-IDF
    calculateTFIDF(texts, vocabulary) {
        // Calculate TF
        const tfVectors = texts.map(text => {
            const tokens = text.split(/\s+/);
            const vector = {};
            let totalWords = tokens.length;
            
            vocabulary.forEach(word => {
                const count = tokens.filter(token => token === word).length;
                vector[word] = count / totalWords;
            });
            
            return vector;
        });

        // Calculate IDF
        const idf = {};
        vocabulary.forEach(word => {
            const docsWithWord = tfVectors.filter(vector => vector[word] > 0).length;
            idf[word] = Math.log(texts.length / (1 + docsWithWord));
        });

        // Calculate TF-IDF
        return tfVectors.map(tfVector => {
            const tfidfVector = {};
            vocabulary.forEach(word => {
                tfidfVector[word] = tfVector[word] * idf[word];
            });
            return tfidfVector;
        });
    }

    // Main preprocessing function
    async preprocess(settings) {
        try {
            const rawData = await this.loadData();
            this.currentSettings = settings;
    
            const { useStemming, useLemmatization, useTF, useTFIDF, useWord2Vec, vectorSize, 
                    useSMOTE, useOversampling, useUndersampling } = settings;
    
            // Every feature extraction method is processed by the backend, so
            // this preview and model training run the same pipeline
            // (services/preprocessing.py) and cannot diverge.
            {
                const response = await fetch('/api/preprocess_preview', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        settings: settings,
                        rows: rawData,
                        textCol: 'text'
                    })
                });
    
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.detail || error.error || 'Preprocessing failed');
                }
    
                const backendResults = await response.json();

                // Format results for display
                this.processedData = {
                    original: rawData,
                    processed: rawData.map((item, idx) => ({
                        ...item,
                        processedText: idx === 0
                            ? (backendResults.processed_sample || item.text)
                            : item.text
                    })),
                    vectors: [], // Backend handles vectors
                    vocabulary: {
                        size: backendResults.vocab_size,
                        actualVectorSize: backendResults.vector_dimensions
                    },
                    settings: settings,
                    classDistribution: {
                        original: backendResults.original_class_distribution,
                        processed: backendResults.processed_class_distribution
                    },
                    resampling: backendResults.resampling || null
                };
                
                return this.processedData;
            }
    
            // Unreachable: the block above returns for every feature extraction
            // method. Retained only as a reference implementation.
            /* eslint-disable no-unreachable */
            // Normalize texts
            const processedTexts = rawData.map(item => ({
                ...item,
                processedText: this.normalizeText(item.text, useStemming, useLemmatization)
            }));
    
            // Build vocabulary
            const texts = processedTexts.map(item => item.processedText);
            this.buildVocabulary(texts);
    
            // Vectorize
            const vectors = this.vectorizeTexts(texts, useTF, useTFIDF, useWord2Vec, vectorSize);
    
            // Apply class imbalance handling (client-side)
            let finalData = processedTexts;
            let finalVectors = vectors;
            
            if (useSMOTE || useOversampling || useUndersampling) {
                const balanced = this.applyClassBalancing(
                    processedTexts, 
                    vectors, 
                    { useSMOTE, useOversampling, useUndersampling }
                );
                finalData = balanced.data;
                finalVectors = balanced.vectors;
            }
    
            this.processedData = {
                original: rawData,
                processed: finalData,
                vectors: finalVectors,
                vocabulary: {
                    size: this.vocabulary.size,
                    actualVectorSize: Math.ceil(this.vocabulary.size * (vectorSize / 100))
                },
                settings: settings
            };
    
            return this.processedData;
    
        } catch (error) {
            console.error("Preprocessing error:", error);
            throw error;
        }
    }
    
    // Add this new method for client-side class balancing
    applyClassBalancing(data, vectors, settings) {
        const { useSMOTE, useOversampling, useUndersampling } = settings;
        
        // Group by class
        const classCounts = {};
        data.forEach(item => {
            const label = item.label || 'Unlabeled';
            classCounts[label] = (classCounts[label] || 0) + 1;
        });
        
        const maxCount = Math.max(...Object.values(classCounts));
        const minCount = Math.min(...Object.values(classCounts));
        
        let balancedData = [];
        let balancedVectors = [];
        
        if (useOversampling || useSMOTE) {
            // Oversample minority classes to match majority
            Object.keys(classCounts).forEach(className => {
                const classItems = data.filter(item => (item.label || 'Unlabeled') === className);
                const classVectors = vectors.filter((_, idx) => (data[idx].label || 'Unlabeled') === className);
                
                balancedData.push(...classItems);
                balancedVectors.push(...classVectors);
                
                const needed = maxCount - classItems.length;
                for (let i = 0; i < needed; i++) {
                    const randomIdx = Math.floor(Math.random() * classItems.length);
                    balancedData.push({...classItems[randomIdx]});
                    balancedVectors.push({...classVectors[randomIdx]});
                }
            });
        } else if (useUndersampling) {
            // Undersample majority classes to match minority
            Object.keys(classCounts).forEach(className => {
                const classItems = data.filter(item => (item.label || 'Unlabeled') === className);
                const classVectors = vectors.filter((_, idx) => (data[idx].label || 'Unlabeled') === className);
                
                // Randomly sample minCount items
                const shuffled = classItems.map((item, idx) => ({ item, vector: classVectors[idx] }))
                                           .sort(() => 0.5 - Math.random());
                
                for (let i = 0; i < Math.min(minCount, shuffled.length); i++) {
                    balancedData.push(shuffled[i].item);
                    balancedVectors.push(shuffled[i].vector);
                }
            });
        }
        
        return { data: balancedData, vectors: balancedVectors };
    }

    // Store processed data for predictive modeling
    storeForModeling() {
        if (!this.processedData) {
          throw new Error("No processed data available");
        }
      
        // Store only essential information to avoid quota issues
        const essentialInfo = {
          settings: this.currentSettings,
          vocabulary: {
            // Vocabulary is built by the backend pipeline.
            size: this.processedData.vocabulary.size,
            actualVectorSize: this.processedData.vocabulary.actualVectorSize
          },
          documentCount: this.processedData.processed.length,
          sample: this.processedData.processed.slice(0, 3) // Store only a small sample
        };
      
        try {
          sessionStorage.setItem("preprocessingSettings", JSON.stringify(essentialInfo.settings));
          sessionStorage.setItem("preprocessingInfo", JSON.stringify({
            vocabularySize: essentialInfo.vocabulary.size,
            vectorSize: essentialInfo.vocabulary.actualVectorSize,
            methods: this.getMethodsString(essentialInfo.settings),
            documentCount: essentialInfo.documentCount
          }));
          
          // Don't store the entire processed data - it's too large
          // The actual processing will be done on the server side
          
          return true;
        } catch (error) {
          console.warn("Could not store all preprocessing info:", error);
          
          // Store minimal info
          sessionStorage.setItem("preprocessingApplied", "true");
          sessionStorage.setItem("preprocessingSettings", JSON.stringify(this.currentSettings));
          
          return true;
        }
      }
}

function toggleTextNormalizationSection(featureMethodId) {
    // Find the text normalization section
    const normalizationSections = document.querySelectorAll('.control-section');
    let normalizationSection = null;
    
    normalizationSections.forEach(section => {
        const heading = section.querySelector('h3');
        if (heading && heading.textContent.includes('Text Normalization')) {
            normalizationSection = section;
        }
    });
    
    if (!normalizationSection) return;
    
    // Show only for TF and TF-IDF, hide for Word2Vec
    if (featureMethodId === 'useWord2Vec') {
        normalizationSection.style.display = 'none';
        // Uncheck any normalization options when hidden
        document.getElementById('useStemming').checked = false;
        document.getElementById('useLemmatization').checked = false;
    } else {
        normalizationSection.style.display = 'block';
    }
}
// Add this BEFORE the PreprocessingUI class definition
function updateVectorSizeInput(featureMethodId) {
    // Handle normalization section visibility
    const normalizationCheckboxes = document.getElementById('normalizationCheckboxes');
    const normalizationDisabledMessage = document.getElementById('normalizationDisabledMessage');
    const normalizationNote = document.getElementById('normalizationNote');
    
    // Check if any feature is actually selected
    const isTFSelected = document.getElementById('useTF').checked;
    const isTFIDFSelected = document.getElementById('useTFIDF').checked;
    const isWord2VecSelected = document.getElementById('useWord2Vec').checked;
    
    const vectorSlider = document.getElementById('vectorSize');
    const vectorValue = document.getElementById('vectorSizeValue');
    const vectorContainer = vectorSlider ? vectorSlider.parentElement : null;
    
    // Check current state - is it already Word2Vec slider or TF/TF-IDF slider?
    const currentMax = vectorSlider ? parseInt(vectorSlider.max) : 100;
    const isCurrentlyWord2Vec = currentMax === 200;
    
    // If nothing is selected, show only title
    if (!isTFSelected && !isTFIDFSelected && !isWord2VecSelected) {
        normalizationCheckboxes.style.display = 'none';
        normalizationNote.style.display = 'none';
        normalizationDisabledMessage.style.display = 'block';
        document.getElementById('useStemming').checked = false;
        document.getElementById('useLemmatization').checked = false;
        
        const vocabInfo = document.querySelector('.vector-info');
        if (vocabInfo) vocabInfo.style.display = 'block';
        
        const vectorLabel = document.querySelector('label[for="vectorSize"]');
        if (vectorLabel) vectorLabel.style.display = 'block';
        
        if (vectorContainer && isCurrentlyWord2Vec) {
            vectorSlider.min = "10";
            vectorSlider.max = "100";
            vectorSlider.value = "100";
            vectorValue.textContent = "100%";
            
            // Remove old event listener by cloning the slider
            const newSlider = vectorSlider.cloneNode(true);
            vectorSlider.parentNode.replaceChild(newSlider, vectorSlider);
            
            // Add new event listener for percentage
            const ui = window.preprocessingUI;
            document.getElementById('vectorSize').addEventListener('input', function(e) {
                document.getElementById('vectorSizeValue').textContent = `${e.target.value}%`;
                if (ui) ui.updateVectorInfo();
            });
        }
        return;
    }
    
    if (isWord2VecSelected) {
        // Word2Vec: Hide normalization options
        normalizationCheckboxes.style.display = 'none';
        normalizationNote.style.display = 'none';
        normalizationDisabledMessage.style.display = 'block';
        document.getElementById('useStemming').checked = false;
        document.getElementById('useLemmatization').checked = false;
        
        const vocabInfo = document.querySelector('.vector-info');
        if (vocabInfo) vocabInfo.style.display = 'none';
        
        const vectorLabel = document.querySelector('label[for="vectorSize"]');
        if (vectorLabel) vectorLabel.style.display = 'none';
        
        // Only update slider if not already Word2Vec slider
        if (vectorContainer && !isCurrentlyWord2Vec) {
            vectorSlider.min = "10";
            vectorSlider.max = "200";
            vectorSlider.value = "100";
            vectorValue.textContent = "100 dimensions";
            
            // Remove old event listener by cloning the slider
            const newSlider = vectorSlider.cloneNode(true);
            vectorSlider.parentNode.replaceChild(newSlider, vectorSlider);
            
            // Add new event listener for dimensions
            const ui = window.preprocessingUI;
            document.getElementById('vectorSize').addEventListener('input', function(e) {
                document.getElementById('vectorSizeValue').textContent = `${e.target.value} dimensions`;
                if (ui) ui.updateVectorInfo();
            });
        }
    } else if (isTFSelected || isTFIDFSelected) {
        normalizationCheckboxes.style.display = 'block';
        normalizationNote.style.display = 'block';
        normalizationDisabledMessage.style.display = 'none';
        
        // ALWAYS show vocabulary info and label for TF/TF-IDF
        const vocabInfo = document.querySelector('.vector-info');
        if (vocabInfo) vocabInfo.style.display = 'block';
        
        const vectorLabel = document.querySelector('label[for="vectorSize"]');
        if (vectorLabel) vectorLabel.style.display = 'block';
        
        // Only update slider if currently Word2Vec slider
        if (vectorContainer && isCurrentlyWord2Vec) {
            vectorSlider.min = "10";
            vectorSlider.max = "100";
            vectorSlider.value = "100";
            vectorValue.textContent = "100%";
            
            // Remove old event listener by cloning the slider
            const newSlider = vectorSlider.cloneNode(true);
            vectorSlider.parentNode.replaceChild(newSlider, vectorSlider);
            
            // Add new event listener for percentage
            const ui = window.preprocessingUI;
            document.getElementById('vectorSize').addEventListener('input', function(e) {
                document.getElementById('vectorSizeValue').textContent = `${e.target.value}%`;
                if (ui) ui.updateVectorInfo();
            });
            if (ui) ui.updateVectorInfo();
        }
    }
}


// UI Controller
// UI Controller
class PreprocessingUI {
    constructor() {
        this.preprocessor = new TextPreprocessor();
        this.lastResults = null;
        this.initializeEventListeners();
        this.loadVocabularyInfo();
        this.initializeNormalizationVisibility();
    }
    
    initializeNormalizationVisibility() {
        // Check which feature is initially selected (if any)
        const featureCheckboxes = document.querySelectorAll('input[name="feature"]');
        let selectedFeature = null;
        
        featureCheckboxes.forEach(checkbox => {
            if (checkbox.checked) {
                selectedFeature = checkbox.id;
            }
        });
        
        // If Word2Vec is selected on load, hide normalization section
        if (selectedFeature === 'useWord2Vec') {
            toggleTextNormalizationSection('useWord2Vec');
        }
    }

    initializeEventListeners() {
        // Normalization checkboxes are mutually exclusive.
        const normalizationCheckboxes = document.querySelectorAll('input[name="normalization"]');
        normalizationCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                if (this.checked) {
                    normalizationCheckboxes.forEach(other => {
                        if (other !== this) other.checked = false;
                    });
                }
            });
        });
    
        // Feature extraction checkboxes are mutually exclusive.
        // Normalization applies to TF and TF-IDF only.
        const featureCheckboxes = document.querySelectorAll('input[name="feature"]');
        featureCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                if (this.checked) {
                    // Uncheck other feature checkboxes
                    featureCheckboxes.forEach(other => {
                        if (other !== this) other.checked = false;
                    });
                    
                    // Update vector size input (Word2Vec vs TF/TF-IDF)
                    updateVectorSizeInput(this.id);
                    
                    // Show/hide normalization section based on selection
                    toggleTextNormalizationSection(this.id);
                } else {
                    // If unchecked, reset to default view
                    updateVectorSizeInput(null);
                }
            });
        });
    
        // Class imbalance checkboxes are mutually exclusive.
        const imbalanceCheckboxes = document.querySelectorAll('input[name="imbalance"]');
        imbalanceCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', function() {
                if (this.checked) {
                    imbalanceCheckboxes.forEach(other => {
                        if (other !== this) other.checked = false;
                    });
                }
            });
        });
    
        // Vector size slider
        const vectorSlider = document.getElementById('vectorSize');
        const vectorValue = document.getElementById('vectorSizeValue');
        vectorSlider.addEventListener('input', (e) => {
            // Check if Word2Vec is selected
            const isWord2Vec = document.getElementById('useWord2Vec')?.checked;
            if (isWord2Vec) {
                vectorValue.textContent = `${e.target.value} dimensions`;
            } else {
                vectorValue.textContent = `${e.target.value}%`;
            }
            this.updateVectorInfo();
        });
    
        // Preprocess button
        document.getElementById('preprocessBtn').addEventListener('click', () => {
            this.runPreprocessing();
        });
    
        // Reset button
        document.getElementById('resetBtn').addEventListener('click', () => {
            this.resetForm();
        });
    
        // Proceed to modeling button
        document.getElementById('proceedToModeling').addEventListener('click', () => {
            this.proceedToModeling();
        });
    }

    async loadVocabularyInfo() {
        try {
            const data = await this.preprocessor.loadData();
            const texts = data.map(item => item.text);
            const vocab = this.preprocessor.buildVocabulary(texts);
            
            document.getElementById('vocabSize').textContent = `Vocabulary size: ${vocab.size}`;
            this.updateVectorInfo();
        } catch (error) {
            console.error("Error loading vocabulary info:", error);
            document.getElementById('vocabSize').textContent = 'Vocabulary size: Error loading data';
        }
    }

    updateVectorInfo() {
        const vectorSlider = document.getElementById('vectorSize');
        const vectorSize = parseInt(vectorSlider.value);
        const vocabSize = this.preprocessor.vocabulary.size;
        
        const isWord2VecSelected = document.getElementById('useWord2Vec').checked;
        
        if (isWord2VecSelected) {
            // For Word2Vec, vectorSize is the actual dimensions, not a percentage
            document.getElementById('actualVectorSize').textContent = 
                `Actual vector size: ${vectorSize} dimensions`;
        } else {
            // For TF/TF-IDF, vectorSize is a percentage of vocabulary
            const actualSize = Math.floor(vocabSize * (vectorSize / 100));
            document.getElementById('actualVectorSize').textContent = 
                `Actual vector size: ${actualSize}`;
        }
    }

    async runPreprocessing() {
        const preprocessBtn = document.getElementById('preprocessBtn');
        const originalBtnText = preprocessBtn.textContent;
        try {
            preprocessBtn.disabled = true;
            preprocessBtn.textContent = "Processing...";

            const settings = {
                useStemming: document.getElementById('useStemming').checked,
                useLemmatization: document.getElementById('useLemmatization').checked,
                useTF: document.getElementById('useTF').checked,
                useTFIDF: document.getElementById('useTFIDF').checked,
                useWord2Vec: document.getElementById('useWord2Vec').checked,
                vectorSize: parseInt(document.getElementById('vectorSize').value),
                useSMOTE: document.getElementById('useSMOTE').checked,
                useOversampling: document.getElementById('useOversampling').checked,
                useUndersampling: document.getElementById('useUndersampling').checked
            };

            // Validate settings
            if (settings.useStemming && settings.useLemmatization) {
                throw new Error("Please select either Stemming OR Lemmatization, not both");
            }

            const featureSelected = [settings.useTF, settings.useTFIDF, settings.useWord2Vec].filter(Boolean);
            if (featureSelected.length === 0) {
                throw new Error("Please select at least one feature extraction method");
            }
            if (featureSelected.length > 1) {
                throw new Error("Please select ONLY ONE feature extraction method. You currently have " + featureSelected.length + " selected.");
            }

            const imbalanceSelected = [settings.useSMOTE, settings.useOversampling, settings.useUndersampling].filter(Boolean);
            if (imbalanceSelected.length > 1) {
                throw new Error("Please select ONLY ONE class imbalance method. You currently have " + imbalanceSelected.length + " selected.");
            }

            // Build methods label for subtitle
            const normMethod = settings.useStemming ? 'Stemming' : settings.useLemmatization ? 'Lemmatization' : 'None';
            const featureMethod = settings.useWord2Vec ? 'Word2Vec' : settings.useTFIDF ? 'TF-IDF' : 'TF';
            const balanceMethod = settings.useSMOTE ? 'SMOTE' : settings.useOversampling ? 'Oversampling' : settings.useUndersampling ? 'Undersampling' : null;
            const methodsLabel = [normMethod !== 'None' ? normMethod : null, featureMethod, balanceMethod]
                .filter(Boolean).join(' | ');

            showLoadingBar('Applying Preprocessing', methodsLabel);

            // Step 0: Load data
            setLoadingStep(0, 'Reading from session storage...');
            await animateProgress(0, 18, 350, 'Loading documents...', 'Estimated time: ~5s');

            // Step 1: Text normalization
            setLoadingStep(1, `Applying ${normMethod}...`);
            await animateProgress(18, 38, 450, `${normMethod} in progress...`, 'Estimated time: ~4s');

            // Start real preprocessing
            const resultsPromise = this.preprocessor.preprocess(settings);

            // Step 2: Feature extraction
            setLoadingStep(2, `Building ${featureMethod} matrix...`);
            await animateProgress(38, 62, 500, `Vectorizing with ${featureMethod}...`, 'Estimated time: ~3s');

            // Step 3: Class balancing
            if (balanceMethod) {
                setLoadingStep(3, `Running ${balanceMethod}...`);
                await animateProgress(62, 82, 450, `${balanceMethod} oversampling...`, 'Estimated time: ~2s');
            } else {
                setLoadingStep(3, 'No resampling selected');
                await animateProgress(62, 82, 250, 'Skipping class balancing...', 'Estimated time: ~1s');
            }

            // Wait for real preprocessing
            const results = await resultsPromise;
            this.lastResults = results;

            // Step 4: Finalize
            setLoadingStep(4, 'Saving results...');
            await animateProgress(82, 100, 350, 'Finalizing...', 'Almost done');
            await new Promise(r => setTimeout(r, 400));
            hideLoadingBar();

            this.displayResults(results);

        } catch (error) {
            hideLoadingBar();
            this.showError(error.message);
        } finally {
            preprocessBtn.disabled = false;
            preprocessBtn.textContent = originalBtnText;
        }
    }

    displayResults(results) {
        const resultsSection = document.getElementById('preprocessingResults');
        const originalText = document.getElementById('originalText');
        const processedText = document.getElementById('processedText');
        const vectorInfo = document.getElementById('vectorInfo');
        
        // Show original and processed text samples
        if (results.processed.length > 0) {
            const sample = results.processed[0];
            originalText.textContent = sample.originalText || sample.text || "No sample available";
            processedText.textContent = sample.processedText || "No sample available";
        }
        
        // Calculate class distributions
        const classDistributionHTML = this.getClassDistributionHTML(results);
        
        const isWord2Vec = results.settings.useWord2Vec;
        const vectorSizeNote = isWord2Vec ? ' (Word2Vec dimensions)' : '';
        
        // Show vector information
        vectorInfo.innerHTML = `
            <div class="stat-item">
                <strong>Vocabulary Size:</strong> ${results.vocabulary.size.toLocaleString()}
            </div>
            <div class="stat-item">
                <strong>Vector Size:</strong> ${results.vocabulary.actualVectorSize.toLocaleString()}${vectorSizeNote}
            </div>
            <div class="stat-item">
                <strong>Documents Processed:</strong> ${results.processed.length.toLocaleString()}
            </div>
            <div class="stat-item">
                <strong>Methods Applied:</strong> ${this.getMethodsString(results.settings)}
            </div>
            ${classDistributionHTML}
        `;
        
        resultsSection.style.display = 'block';
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    getMethodsString(settings) {
        const methods = [];
        
        // Normalization
        if (settings.useStemming) methods.push('Stemming');
        if (settings.useLemmatization) methods.push('Lemmatization');
        
        // Feature Extraction
        if (settings.useTF) methods.push('TF');
        if (settings.useTFIDF) methods.push('TF-IDF');
        if (settings.useWord2Vec) methods.push('Word2Vec');
        
        // Class Imbalance Handling
        if (settings.useSMOTE) methods.push('SMOTE');
        if (settings.useOversampling) methods.push('Random Oversampling');
        if (settings.useUndersampling) methods.push('Random Undersampling');
        
        return methods.join(', ') || 'None';
    }

    getClassDistributionHTML(results) {
        const settings = results.settings;
        
        // Only show class distribution if imbalance handling was applied
        if (!settings.useSMOTE && !settings.useOversampling && !settings.useUndersampling) {
            return '';
        }
        
        let html = '<div class="stat-item" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e0e0e0;">';
        html += '<strong>Class Distribution:</strong>';
        html += '</div>';

        // A resampler that ran but generated nothing looks identical to no
        // resampling at all. Say so explicitly, otherwise a balanced dataset
        // silently produces a "SMOTE" result that is not a SMOTE result.
        const rs = results.resampling;
        if (rs && rs.applied && rs.n_synthetic === 0) {
            html += '<div class="stat-item" style="margin-top:8px;padding:10px;' +
                    'background:#fff8e1;border-left:4px solid #f0ad4e;border-radius:4px;">' +
                    `<strong>${rs.method} generated no new samples.</strong> ` +
                    'The dataset is already balanced across classes, so there is no ' +
                    'minority class to resample. Results will be identical to running ' +
                    'without resampling.' +
                    '</div>';
        } else if (rs && rs.applied && rs.n_synthetic > 0) {
            html += '<div class="stat-item" style="margin-top:8px;color:#555;">' +
                    `${rs.method} generated ${rs.n_synthetic.toLocaleString()} ` +
                    'new training samples' +
                    (rs.params && rs.params.k_neighbors
                        ? ` (k_neighbors=${rs.params.k_neighbors}).`
                        : '.') +
                    '</div>';
        }
        
        // Check if we have backend-provided class distribution (Word2Vec case)
        if (results.classDistribution) {
            // Use backend results
            const originalDist = results.classDistribution.original;
            const processedDist = results.classDistribution.processed;
            
            // Original distribution
            html += '<div class="stat-item" style="font-size: 0.9em; padding-left: 10px;">';
            html += '<span style="color: #666;">Before: </span>';
            html += Object.entries(originalDist)
                .map(([label, count]) => `${label}: ${count}`)
                .join(', ');
            html += '</div>';
            
            // Processed distribution
            html += '<div class="stat-item" style="font-size: 0.9em; padding-left: 10px;">';
            html += '<span style="color: #666;">After: </span>';
            html += Object.entries(processedDist)
                .map(([label, count]) => `${label}: ${count}`)
                .join(', ');
            html += '</div>';
        } else {
            // Calculate from frontend data (TF/TF-IDF case)
            const originalDist = {};
            results.original.forEach(item => {
                const label = item.label || 'Unlabeled';
                originalDist[label] = (originalDist[label] || 0) + 1;
            });
            
            const processedDist = {};
            results.processed.forEach(item => {
                const label = item.label || 'Unlabeled';
                processedDist[label] = (processedDist[label] || 0) + 1;
            });
            
            // Original distribution
            html += '<div class="stat-item" style="font-size: 0.9em; padding-left: 10px;">';
            html += '<span style="color: #666;">Before: </span>';
            html += Object.entries(originalDist)
                .map(([label, count]) => `${label}: ${count}`)
                .join(', ');
            html += '</div>';
            
            // Processed distribution
            html += '<div class="stat-item" style="font-size: 0.9em; padding-left: 10px;">';
            html += '<span style="color: #666;">After: </span>';
            html += Object.entries(processedDist)
                .map(([label, count]) => `${label}: ${count}`)
                .join(', ');
            html += '</div>';
        }
        
        return html;
    }

    resetForm() {
        // Reset normalization checkboxes
        document.getElementById('useStemming').checked = false;
        document.getElementById('useLemmatization').checked = false;
        
        // Reset feature extraction checkboxes
        document.getElementById('useTF').checked = false;
        document.getElementById('useTFIDF').checked = false;
        document.getElementById('useWord2Vec').checked = false;
        
        // Reset class imbalance checkboxes
        document.getElementById('useSMOTE').checked = false;
        document.getElementById('useOversampling').checked = false;
        document.getElementById('useUndersampling').checked = false;
        
        // Reset slider to default
        const vectorSlider = document.getElementById('vectorSize');
        vectorSlider.value = 100;
        vectorSlider.min = "10";
        vectorSlider.max = "100";
        document.getElementById('vectorSizeValue').textContent = '100%';
        
        // Show normalization section (reset to TF/TF-IDF default)
        const normalizationSection = document.querySelector('.control-section');
        if (normalizationSection) {
            normalizationSection.style.display = 'block';
        }
        
        // Show vocabulary info
        const vocabInfo = document.querySelector('.vector-info');
        if (vocabInfo) vocabInfo.style.display = 'block';
        
        // Hide results
        document.getElementById('preprocessingResults').style.display = 'none';
        
        this.updateVectorInfo();
    }

    async proceedToModeling() {
        try {
            if (!this.lastResults) {
                this.showError("Please run preprocessing first before proceeding to modeling");
                return;
            }

            // Build methods label
            const savedSettings = this.preprocessor.currentSettings;
            const methodsStr = this.getMethodsString(savedSettings);
            showLoadingBar('Preparing for Modeling', methodsStr);

            setLoadingStep(0, 'Validating results...');
            await animateProgress(0, 25, 300, 'Checking preprocessing output...', '~2s');
            
            // Calculate class distributions for storage
            const originalDist = {};
            const processedDist = {};
            
            this.lastResults.original.forEach(item => {
                const label = item.label || 'Unlabeled';
                originalDist[label] = (originalDist[label] || 0) + 1;
            });
            
            this.lastResults.processed.forEach(item => {
                const label = item.label || 'Unlabeled';
                processedDist[label] = (processedDist[label] || 0) + 1;
            });
            
            // Store only essential data
            const essentialData = {
                settings: this.preprocessor.currentSettings,
                vocabulary: {
                    // From the backend pipeline (see storeForModeling).
                    size: this.preprocessor.processedData.vocabulary.size,
                    actualVectorSize: this.lastResults.vocabulary.actualVectorSize
                },
                sample: this.lastResults.processed.slice(0, 5),
                classDistribution: {
                    original: originalDist,
                    processed: processedDist
                }
            };
            
            sessionStorage.setItem("preprocessingSettings", JSON.stringify(essentialData.settings));
            sessionStorage.setItem("preprocessingInfo", JSON.stringify({
                vocabularySize: essentialData.vocabulary.size,
                vectorSize: essentialData.vocabulary.actualVectorSize,
                methods: this.getMethodsString(essentialData.settings),
                documentCount: this.lastResults.processed.length,
                classDistribution: essentialData.classDistribution
            }));

            // runSelectedModels() reads this flag before training.
            sessionStorage.setItem("preprocessingApplied", "true");

            console.log("Preprocessing data stored successfully");

            // Navigate to predictive modeling
            window.location.href = "/predictive";
            
        } catch (error) {
            console.error("Failed to store preprocessing results:", error);
            
            // Fallback: Try to store even less data
            try {
                sessionStorage.setItem("preprocessingSettings", JSON.stringify(this.preprocessor.currentSettings));
                sessionStorage.setItem("preprocessingApplied", "true");
                window.location.href = "/predictive";
            } catch (fallbackError) {
                this.showError("Storage limit exceeded. Clearing some data and trying again...");
                
                // Clear some session storage and try again
                sessionStorage.removeItem("preprocessedData");
                sessionStorage.setItem("preprocessingApplied", "true");
                
                setTimeout(() => {
                    window.location.href = "/predictive";
                }, 1000);
            }
        }
    }

    showError(message) {
        alert(`Error: ${message}`);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    if (!window.isDatasetLabeled()) {
        window.showLabeledDatasetRequiredModal('Preprocessing');
        return;
    }
    window.preprocessingUI = new PreprocessingUI();
});