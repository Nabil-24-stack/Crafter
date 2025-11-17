import * as fs from 'fs';
import * as path from 'path';

// Types for our dataset structure
interface TrainingExample {
  messages: {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }[];
}

interface FileMetadata {
  category: string;
  scenario: string;
  platform: string;
  version: string;
  filePath: string;
}

// Seeded shuffle function for deterministic randomization
function shuffleWithSeed<T>(array: T[], seed: number): T[] {
  const shuffled = [...array];
  let currentSeed = seed;

  // Simple LCG (Linear Congruential Generator) for deterministic randomness
  const random = () => {
    currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
    return currentSeed / 0x7fffffff;
  };

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

// Parse filename to extract metadata
function parseFilename(filename: string): Omit<FileMetadata, 'category' | 'filePath'> | null {
  // Pattern: <category>_<scenario>_<platform>_<version>.json
  const match = filename.match(/^(.+?)_(.+?)_(web|mobile)_(v\d+)\.json$/);

  if (!match) {
    console.warn(`Skipping file with invalid naming pattern: ${filename}`);
    return null;
  }

  return {
    scenario: match[2],
    platform: match[3],
    version: match[4],
  };
}

// Walk directory recursively and find all JSON files
function walkDirectory(dir: string, parentCategory?: string): FileMetadata[] {
  const results: FileMetadata[] = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Use directory name as category
      const category = file;
      results.push(...walkDirectory(filePath, category));
    } else if (file.endsWith('.json') && parentCategory) {
      const metadata = parseFilename(file);
      if (metadata) {
        results.push({
          ...metadata,
          category: parentCategory,
          filePath,
        });
      }
    }
  }

  return results;
}

// Create a training example from file metadata
function createTrainingExample(metadata: FileMetadata): TrainingExample {
  // Read the JSON file content
  const jsonContent = fs.readFileSync(metadata.filePath, 'utf-8');

  // Create the training example in Together AI messages format
  const example: TrainingExample = {
    messages: [
      {
        role: 'system',
        content: 'You are Crafter, an assistant that generates Figma-style UI layout JSON. You always respond with a single JSON object describing the layout tree. Do not include explanations, markdown, or comments.',
      },
      {
        role: 'user',
        content: `Design a ${metadata.platform} ${metadata.category} screen for ${metadata.scenario}. Use a clean, production-ready layout with good hierarchy, spacing, and realistic text. Return only the JSON layout object.`,
      },
      {
        role: 'assistant',
        content: jsonContent,
      },
    ],
  };

  return example;
}

// Main function
function main() {
  console.log('🔍 Building dataset for fine-tuning...\n');

  const datasetDir = path.join(__dirname, '..', 'dataset');
  const outputDir = path.join(__dirname, '..', 'output');

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Walk the dataset directory
  console.log(`📂 Scanning ${datasetDir}...`);
  const fileMetadata = walkDirectory(datasetDir);

  console.log(`✅ Found ${fileMetadata.length} valid dataset files\n`);

  // Create training examples
  console.log('🏗️  Creating training examples...');
  const examples = fileMetadata.map((metadata) => {
    console.log(`  • ${metadata.category}/${metadata.scenario} (${metadata.platform})`);
    return createTrainingExample(metadata);
  });

  console.log(`\n✅ Created ${examples.length} training examples\n`);

  // Shuffle with deterministic seed
  console.log('🔀 Shuffling with seed 42...');
  const shuffled = shuffleWithSeed(examples, 42);

  // Split 80/20 train/validation
  const splitIndex = Math.floor(shuffled.length * 0.8);
  const trainExamples = shuffled.slice(0, splitIndex);
  const validExamples = shuffled.slice(splitIndex);

  console.log(`📊 Split: ${trainExamples.length} train, ${validExamples.length} validation\n`);

  // Write JSONL files (one JSON object per line)
  const trainPath = path.join(outputDir, 'crafter-train.jsonl');
  const validPath = path.join(outputDir, 'crafter-valid.jsonl');

  console.log('💾 Writing JSONL files...');

  // Write training set
  const trainLines = trainExamples.map((ex) => JSON.stringify(ex)).join('\n');
  fs.writeFileSync(trainPath, trainLines + '\n', 'utf-8');
  console.log(`  ✓ ${trainPath}`);

  // Write validation set
  const validLines = validExamples.map((ex) => JSON.stringify(ex)).join('\n');
  fs.writeFileSync(validPath, validLines + '\n', 'utf-8');
  console.log(`  ✓ ${validPath}`);

  console.log('\n✨ Dataset build complete!\n');
  console.log('Summary:');
  console.log(`  Total examples: ${examples.length}`);
  console.log(`  Training set: ${trainExamples.length} examples`);
  console.log(`  Validation set: ${validExamples.length} examples`);
  console.log(`  Output directory: ${outputDir}`);
}

// Run the script
main();
